import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "../types.js";
import { isRunnerOnline } from "../../realtime/runner-ws.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const companyId = ctx.companyId;

  if (companyId && isRunnerOnline(companyId)) {
    checks.push({
      code: "runner_online",
      level: "info",
      message: "A local execution runner is connected for this company.",
    });
  } else {
    checks.push({
      code: "runner_offline",
      level: "warn",
      message: "No local execution runner is connected. Runs will fail until one connects.",
      hint: "Start the runner-client on your machine and pair it with this company.",
    });
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
