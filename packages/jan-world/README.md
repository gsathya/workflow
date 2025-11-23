# @workflow/jan-world

A World implementation for Workflow DevKit that uses PostgreSQL for storage and Google Cloud Tasks for queue management.

## Features

- **PostgreSQL Storage**: Uses Drizzle ORM for type-safe database operations
- **Google Cloud Tasks Queue**: Leverages Google Cloud's managed queue service for reliable task processing
- **Postgres Streaming**: Real-time event streaming using PostgreSQL LISTEN/NOTIFY
- **Hybrid Architecture**: Combines Cloud Tasks for distribution with embedded world for processing

## Installation

```bash
npm install @workflow/jan-world
# or
pnpm add @workflow/jan-world
```

## Prerequisites

1. **PostgreSQL Database**: A PostgreSQL instance (version 12 or higher)
2. **Google Cloud Project**: A GCP project with Cloud Tasks API enabled
3. **Service Account**: A GCP service account with Cloud Tasks permissions

### Setting up Google Cloud Tasks

1. Enable the Cloud Tasks API in your GCP project:
   ```bash
   gcloud services enable cloudtasks.googleapis.com
   ```

2. Create a service account with necessary permissions:
   ```bash
   gcloud iam service-accounts create workflow-tasks \
     --display-name "Workflow Tasks Service Account"

   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:workflow-tasks@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/cloudtasks.enqueuer"
   ```

3. Download the service account key and set the environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
   ```

## Configuration

### Environment Variables

```bash
# PostgreSQL connection
WORKFLOW_POSTGRES_URL="postgres://user:password@localhost:5432/workflow"

# Google Cloud configuration
GCP_PROJECT_ID="your-gcp-project-id"
GCP_LOCATION="us-central1"  # or your preferred region
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"

# Optional: Queue configuration
WORKFLOW_QUEUE_PREFIX="workflow-"
WORKFLOW_QUEUE_CONCURRENCY="10"

# Task handler endpoint (for Cloud Tasks to call)
TASK_HANDLER_URL="https://your-app.com/api/tasks"
```

### Programmatic Configuration

```typescript
import { createWorld } from '@workflow/jan-world';

const world = createWorld({
  connectionString: 'postgres://user:password@localhost:5432/workflow',
  gcpProjectId: 'your-gcp-project-id',
  gcpLocation: 'us-central1',
  queuePrefix: 'workflow-',
  queueConcurrency: 10,
});

// Start the world (ensures queues exist)
await world.start();
```

## Usage

### Basic Usage

```typescript
import { createWorld } from '@workflow/jan-world';

const world = createWorld({
  connectionString: process.env.WORKFLOW_POSTGRES_URL!,
  gcpProjectId: process.env.GCP_PROJECT_ID!,
  gcpLocation: process.env.GCP_LOCATION || 'us-central1',
});

await world.start();

// Use with Workflow DevKit
import { WorkflowContext } from '@workflow/core';

const context = new WorkflowContext({ world });
```

### Setting up Task Handler

Google Cloud Tasks needs an HTTP endpoint to deliver tasks. Create an API route:

```typescript
// app/api/tasks/route.ts (Next.js example)
import { createWorld } from '@workflow/jan-world';

const world = createWorld({
  connectionString: process.env.WORKFLOW_POSTGRES_URL!,
  gcpProjectId: process.env.GCP_PROJECT_ID!,
  gcpLocation: process.env.GCP_LOCATION || 'us-central1',
});

export async function POST(request: Request) {
  const payload = await request.json();

  // Process the task
  await world.processTask(payload);

  return new Response('OK', { status: 200 });
}
```

### Database Setup

The package uses Drizzle ORM. You'll need to run migrations to set up the database schema:

```bash
# Install drizzle-kit
pnpm add -D drizzle-kit

# Generate migrations
pnpm drizzle-kit generate

# Run migrations
pnpm drizzle-kit migrate
```

Or use the schema directly:

```typescript
import { createWorld } from '@workflow/jan-world';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const client = postgres(process.env.WORKFLOW_POSTGRES_URL!);
const db = drizzle(client);

await migrate(db, { migrationsFolder: './migrations' });
```

## Architecture

The jan-world combines:

1. **PostgreSQL Storage Layer**: All workflow state (runs, steps, events, hooks) is stored in PostgreSQL using Drizzle ORM
2. **Google Cloud Tasks Queue**: Tasks are enqueued to Cloud Tasks, which delivers them to your HTTP endpoint
3. **Embedded World Processing**: When tasks are delivered, they're processed using the embedded world from `@workflow/world-local`
4. **PostgreSQL Streaming**: Real-time event streaming using LISTEN/NOTIFY for streaming workflow outputs

```
┌─────────────────┐
│  Workflow SDK   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│   jan-world     │────▶│   PostgreSQL     │
│   (Storage)     │     │   (State)        │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Google Cloud    │────▶│  Task Handler    │
│     Tasks       │     │  (HTTP)          │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Embedded World   │
                        │   (Processing)   │
                        └──────────────────┘
```

## API Reference

### `createWorld(config: JanWorldConfig)`

Creates a new jan-world instance.

#### Config Options

- `connectionString` (string, required): PostgreSQL connection string
- `gcpProjectId` (string, required): Google Cloud project ID
- `gcpLocation` (string, required): GCP region (e.g., 'us-central1')
- `queuePrefix` (string, optional): Prefix for queue names (default: 'workflow-')
- `queueConcurrency` (number, optional): Max concurrent tasks (default: 10)

## Comparison with Other Worlds

| Feature | jan-world | world-postgres | world-vercel | world-local |
|---------|-----------|----------------|--------------|-------------|
| Storage | PostgreSQL | PostgreSQL | Vercel KV | Filesystem |
| Queue | Cloud Tasks | pg-boss | Vercel Queue | In-memory |
| Production Ready | Yes | Yes | Yes | No |
| Best For | GCP deployments | Self-hosted | Vercel platform | Development |

## Troubleshooting

### Queue Creation Fails

Ensure:
1. Cloud Tasks API is enabled in your GCP project
2. Service account has `cloudtasks.enqueuer` role
3. `GOOGLE_APPLICATION_CREDENTIALS` is set correctly

### Tasks Not Processing

Verify:
1. `TASK_HANDLER_URL` is accessible from Google Cloud Tasks
2. Your HTTP handler is correctly calling `world.processTask()`
3. Service account has permissions to create tasks

### Database Connection Issues

Check:
1. PostgreSQL is running and accessible
2. Connection string is correct
3. Database user has necessary permissions

## License

Apache-2.0
