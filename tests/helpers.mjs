export function summarize(plan) {
  return {
    count: plan.timers.length,
    totalSeconds: plan.timers.reduce((total, timer) => total + timer.seconds, 0),
    warmups: plan.timers.filter((timer) => timer.kind === "warmup").length,
    cooldowns: plan.timers.filter((timer) => timer.kind === "cooldown").length,
    work: plan.timers.filter((timer) => timer.kind === "work").length,
    rest: plan.timers.filter((timer) => timer.kind === "rest").length,
    workSeconds: [
      ...new Set(plan.timers.filter((timer) => timer.kind === "work").map((timer) => timer.seconds)),
    ],
    restSeconds: [
      ...new Set(plan.timers.filter((timer) => timer.kind === "rest").map((timer) => timer.seconds)),
    ],
  };
}
