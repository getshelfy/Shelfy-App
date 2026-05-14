import { createApplication } from "@specific-dev/framework";
import * as schema from './db/schema/schema.js';

// Import route registration functions
// import { registerUserRoutes } from './routes/users.js';

// Create application with schema for full database type support
export const app = await createApplication(schema);

// Export App type for use in route files
export type App = typeof app;

// Register routes - add your route modules here
// IMPORTANT: Always use registration functions to avoid circular dependency issues
// registerUserRoutes(app);

await app.run();
app.logger.info('Application running');
