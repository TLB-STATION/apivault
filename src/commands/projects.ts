import { Command } from "commander";
import { ApiClient } from "../http";
import {
  setConfigValue,
  getLocalProject,
  readLocalConfig,
  readGlobalConfig,
  unlinkLocalProject,
  getActiveProjectId,
  type GlobalOptions,
} from "../config";
import { printJson, printSuccess, dim, green, cyan, yellow, reportError } from "../ui/format";
import Table from "cli-table3";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  ownerUsername: string;
  createdAt: string;
}

interface ProjectUseOptions {
  local?: boolean;
  global?: boolean;
}

/** apivault projects list */
async function listProjects(json: boolean): Promise<void> {
  const client = new ApiClient();
  const projects = await client.request<ProjectItem[]>("/api/projects", {
    method: "GET",
  });

  if (json) {
    printJson(projects);
    return;
  }

  if (projects.length === 0) {
    process.stdout.write(dim("You are not a member of any projects.\n"));
    return;
  }

  const table = new Table({
    head: ["Name", "ID / Slug", "Role", "Owner"],
    style: { head: ["cyan"], border: ["gray"] },
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: "  ",
    },
  });

  for (const p of projects) {
    table.push([
      p.name,
      `${p.slug}\n${dim(p.id)}`,
      p.role,
      p.ownerUsername,
    ]);
  }

  process.stdout.write("\n" + table.toString() + "\n\n");
}

/** apivault projects use <id> */
async function useProject(id: string, opts: ProjectUseOptions, json: boolean): Promise<void> {
  if (opts.local && opts.global) {
    throw new Error("Cannot specify both --local and --global at the same time.");
  }

  const scope: "local" | "global" = opts.global ? "global" : "local";
  const result = setConfigValue("project", id, { scope });

  if (json) {
    printJson({ project: id, scope: result.scope, file: result.targetPath, set: true });
    return;
  }

  if (result.scope === "local") {
    printSuccess(`Linked current directory to project ${green(id)} ${cyan(`(${result.targetPath})`)}.`);
    process.stdout.write(dim("  Use `apivault projects use --global <id>` if you want to set a system-wide default.\n"));
  } else {
    printSuccess(`Global default project set to ${green(id)}.`);
  }
}

/** apivault projects unlink */
async function unlinkProject(json: boolean): Promise<void> {
  const unlinked = unlinkLocalProject();
  if (json) {
    printJson({ unlinked });
    return;
  }

  if (unlinked) {
    printSuccess("Removed local project configuration (.apivault.json).");
  } else {
    process.stdout.write(dim("No local project configuration found in this directory.\n"));
  }
}

/** apivault projects current */
async function showCurrentProject(cliFlag: string | undefined, json: boolean): Promise<void> {
  let source = "none";
  let activeId: string | undefined = undefined;
  let filePath: string | null = null;

  if (cliFlag?.trim()) {
    activeId = cliFlag.trim();
    source = "cli_flag";
  } else if (process.env.APIVAULT_PROJECT?.trim()) {
    activeId = process.env.APIVAULT_PROJECT.trim();
    source = "env_var";
  } else {
    const local = readLocalConfig();
    if (local.config.project || local.config.projectId) {
      activeId = local.config.project || local.config.projectId;
      source = "local_config";
      filePath = local.filePath;
    } else {
      const globalConfig = readGlobalConfig();
      if (globalConfig.project) {
        activeId = globalConfig.project;
        source = "global_config";
      }
    }
  }

  if (json) {
    printJson({
      project: activeId || null,
      source,
      filePath,
    });
    return;
  }

  if (!activeId) {
    process.stdout.write(dim("No active project configured. Use `apivault projects use <id>` to link this directory.\n"));
    return;
  }

  const sourceLabels: Record<string, string> = {
    cli_flag: "Command-line flag (--project / -p)",
    env_var: "Environment variable (APIVAULT_PROJECT)",
    local_config: `Local project file (${filePath || ".apivault.json"})`,
    global_config: "Global user config (~/.apivault/config.json)",
  };

  process.stdout.write(`Active project: ${green(activeId)}\n`);
  process.stdout.write(`Resolved from:  ${cyan(sourceLabels[source] || source)}\n`);
}

/** Register the `projects` command group on the parent program. */
export function registerProjectsCommand(program: Command): void {
  const getOpts = () => program.opts<GlobalOptions>();
  const json = () => Boolean(getOpts().json);
  const handle = (err: unknown) => {
    reportError(err, json());
    process.exitCode = 1;
  };

  const projects = program
    .command("projects")
    .alias("project")
    .description("Manage your ApiVault projects and local directory bindings");

  projects
    .command("list")
    .alias("ls")
    .description("List all projects you are a member of")
    .action(async () => {
      await listProjects(json()).catch(handle);
    });

  projects
    .command("use <id>")
    .description("Set the active project for this directory (default: local .apivault.json)")
    .option("-l, --local", "Save in local project directory (.apivault.json, default)")
    .option("-g, --global", "Save in global user config (~/.apivault/config.json)")
    .action(async (id: string, opts: ProjectUseOptions) => {
      await useProject(id, opts, json()).catch(handle);
    });

  projects
    .command("link <id>")
    .description("Link current directory to an ApiVault project (.apivault.json)")
    .action(async (id: string) => {
      await useProject(id, { local: true }, json()).catch(handle);
    });

  projects
    .command("unlink")
    .description("Remove local project binding from current directory")
    .action(async () => {
      await unlinkProject(json()).catch(handle);
    });

  projects
    .command("current")
    .description("Display the currently resolved active project and its source")
    .action(async () => {
      await showCurrentProject(getOpts().project, json()).catch(handle);
    });
}

