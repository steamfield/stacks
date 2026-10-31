import { greeting } from "../app/.server/greeting";

// The slot validates its inputs but performs no scheduled product work yet.
export async function runScheduled(
  env: { GREETING?: unknown },
  scheduledTime: number,
): Promise<void> {
  greeting(env);
  const time = new Date(scheduledTime).toISOString();
  console.info(JSON.stringify({ event: "scheduled", time }));
}

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  await runScheduled(env, controller.scheduledTime);
}

// A separate test entry avoids React Router's virtual build module in the Workers pool.
export default { scheduled } satisfies ExportedHandler<Env>;
