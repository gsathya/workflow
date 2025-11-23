export interface JanWorldConfig {
  /**
   * PostgreSQL connection string for storage
   */
  connectionString: string;

  /**
   * Google Cloud project ID
   */
  gcpProjectId: string;

  /**
   * Google Cloud location/region (e.g., 'us-central1')
   */
  gcpLocation: string;

  /**
   * Optional prefix for queue names
   */
  queuePrefix?: string;

  /**
   * Maximum concurrent tasks to process (default: 10)
   */
  queueConcurrency?: number;
}
