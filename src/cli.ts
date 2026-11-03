import { layouts, resolveLayout } from "./layout";

const args = process.argv.slice(2);
try {
  if (args[0] !== "layout") throw new Error("Usage: layout list | layout resolve [--profile ID] [--existing ID] [--format hwp|hwpx]");
  if (args[1] === "list" && args.length === 2) {
    console.log(JSON.stringify({ profiles: layouts }, null, 2));
  } else if (args[1] === "resolve") {
    const values: Record<string, string> = {};
    for (let i = 2; i < args.length; i += 2) {
      const key = args[i];
      if (!["--profile", "--existing", "--format"].includes(key) || args[i + 1] === undefined || args[i + 1].startsWith("--") || key in values) {
        throw new Error(`Invalid argument: ${key}`);
      }
      values[key] = args[i + 1];
    }
    console.log(JSON.stringify(resolveLayout({ requested: values["--profile"], existing: values["--existing"], format: values["--format"] }), null, 2));
  } else throw new Error("Usage: layout list | layout resolve [--profile ID] [--existing ID] [--format hwp|hwpx]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
