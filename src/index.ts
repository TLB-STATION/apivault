import { Command } from "commander";
import { runLogin, runLogout, runWhoami } from "./connect";
import { registerKeysCommand } from "./commands/keys";
import { registerRunCommand } from "./commands/run";
import { registerConfigCommand } from "./commands/config";
import { reportError } from "./ui/format";
import { readToken } from "./config";

const pkg = {
  name: "apivault-cli",
  version: "0.1.0",
  description: "Command-line client for an ApiVault instance.",
};

const program = new Command();

program
  .name("apivault")
  .description(pkg.description)
  .version(pkg.version)
  .option("--json", "Emit machine-readable JSON output")
  .option(
    "--timeout <seconds>",
    "Seconds to wait for browser approval during login",
    (v) => parseInt(v, 10),
  );

// Top-level commands --------------------------------------------------------

program
  .command("login")
  .description("Open a browser to approve this CLI's connection to your account")
  .action(async () => {
    try {
      await runLogin(program.opts());
    } catch (err) {
      reportError(err, Boolean(program.opts().json));
      process.exitCode = 1;
    }
  });

program
  .command("logout")
  .description("Revoke this device's token and sign out")
  .action(async () => {
    try {
      await runLogout();
    } catch (err) {
      reportError(err, Boolean(program.opts().json));
      process.exitCode = 1;
    }
  });

program
  .command("whoami")
  .description("Show the currently signed-in user")
  .action(async () => {
    try {
      await runWhoami(program.opts());
    } catch (err) {
      reportError(err, Boolean(program.opts().json));
      process.exitCode = 1;
    }
  });

// Subcommand groups ---------------------------------------------------------

registerKeysCommand(program);
registerRunCommand(program);
registerConfigCommand(program);

// When invoked with no arguments at all, print a short status hint. Any
// unrecognized command is left to commander, which exits non-zero with a
// helpful "unknown command" message.
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  const signedIn = Boolean(readToken());
  process.stdout.write(
    "ApiVault CLI\n\n" +
      (signedIn ? "Signed in.\n" : "Not signed in — run `apivault login`.\n") +
      "Run `apivault --help` to see all commands.\n",
  );
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  reportError(err, false);
  process.exit(1);
});
