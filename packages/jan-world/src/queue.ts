import * as Stream from 'node:stream';
import { CloudTasksClient } from '@google-cloud/tasks';
import { JsonTransport } from '@vercel/queue';
import {
  MessageId,
  type Queue,
  QueuePayloadSchema,
  type QueuePrefix,
  type ValidQueueName,
} from '@workflow/world';
import { createEmbeddedWorld } from '@workflow/world-local';
import { monotonicFactory } from 'ulid';
import type { JanWorldConfig } from './config.js';

/**
 * The Google Cloud Tasks queue works by creating two queue types:
 * - `workflow` for workflow jobs
 * - `step` for step jobs
 *
 * When a message is queued, it is sent to Cloud Tasks with the appropriate queue.
 * When a task is processed, it is deserialized and then re-queued into the _embedded world_,
 * showing that we can reuse the embedded world, mix and match worlds to build
 * hybrid architectures, and even migrate between worlds.
 */
export function createQueue(
  config: JanWorldConfig
): Queue & { start(): Promise<void> } {
  const client = new CloudTasksClient();
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;
  const embeddedWorld = createEmbeddedWorld({ dataDir: undefined, port });

  const transport = new JsonTransport();
  const generateMessageId = monotonicFactory();

  const prefix = config.queuePrefix || 'workflow-';
  const Queues = {
    __wkf_workflow_: `${prefix}flows`,
    __wkf_step_: `${prefix}steps`,
  } as const satisfies Record<QueuePrefix, string>;

  const createQueueHandler = embeddedWorld.createQueueHandler;

  const getDeploymentId: Queue['getDeploymentId'] = async () => {
    return 'jan-world';
  };

  /**
   * Get the full queue path for Google Cloud Tasks
   */
  function getQueuePath(queueName: string): string {
    return client.queuePath(config.gcpProjectId, config.gcpLocation, queueName);
  }

  /**
   * Ensure queue exists in Google Cloud Tasks
   */
  async function ensureQueue(queueName: string): Promise<void> {
    try {
      const queuePath = getQueuePath(queueName);
      await client.getQueue({ name: queuePath });
    } catch (error: any) {
      if (error.code === 5) {
        // Queue doesn't exist, create it
        const parent = client.locationPath(
          config.gcpProjectId,
          config.gcpLocation
        );
        await client.createQueue({
          parent,
          queue: {
            name: getQueuePath(queueName),
            rateLimits: {
              maxDispatchesPerSecond: config.queueConcurrency || 10,
            },
          },
        });
      } else {
        throw error;
      }
    }
  }

  const queue: Queue['queue'] = async (queue, message, opts) => {
    const [prefix, queueId] = parseQueueName(queue);
    const jobName = Queues[prefix];
    await ensureQueue(jobName);

    const body = transport.serialize(message);
    const messageId = MessageId.parse(`msg_${generateMessageId()}`);

    const queuePath = getQueuePath(jobName);

    // Create task payload
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: process.env.TASK_HANDLER_URL || 'http://localhost:3000/api/tasks',
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(
          JSON.stringify({
            id: queueId,
            data: body,
            messageId,
            idempotencyKey: opts?.idempotencyKey,
            prefix,
          })
        ),
      },
    };

    // If idempotency key is provided, use it as the task name
    if (opts?.idempotencyKey) {
      const taskName = client.taskPath(
        config.gcpProjectId,
        config.gcpLocation,
        jobName,
        opts.idempotencyKey
      );
      await client.createTask({
        parent: queuePath,
        task: {
          ...task,
          name: taskName,
        },
      });
    } else {
      await client.createTask({
        parent: queuePath,
        task,
      });
    }

    return { messageId };
  };

  /**
   * Process a task payload from Google Cloud Tasks
   * This function should be called by your HTTP handler when it receives a task
   */
  async function processTask(payload: {
    id: string;
    data: string;
    messageId: string;
    idempotencyKey?: string;
    prefix: QueuePrefix;
  }): Promise<void> {
    const bodyStream = Stream.Readable.toWeb(
      Stream.Readable.from([payload.data])
    );
    const body = await transport.deserialize(
      bodyStream as ReadableStream<Uint8Array>
    );
    const message = QueuePayloadSchema.parse(body);
    const queueName = `${payload.prefix}${payload.id}` as const;
    await embeddedWorld.queue(queueName, message, {
      idempotencyKey: payload.idempotencyKey,
    });
  }

  return {
    createQueueHandler,
    getDeploymentId,
    queue,
    processTask,
    async start() {
      // Ensure queues exist
      for (const queueName of Object.values(Queues)) {
        await ensureQueue(queueName);
      }
    },
  } as Queue & { start(): Promise<void>; processTask: typeof processTask };
}

const parseQueueName = (name: ValidQueueName): [QueuePrefix, string] => {
  const prefixes: QueuePrefix[] = ['__wkf_step_', '__wkf_workflow_'];
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      return [prefix, name.slice(prefix.length)];
    }
  }
  throw new Error(`Invalid queue name: ${name}`);
};
