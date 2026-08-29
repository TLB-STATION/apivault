import { Command } from "commander";
import { ApiClient } from "../http";
import { setConfigValue, type GlobalOptions } from "../config";
import { printJson, printSuccess, dim, green, reportError } from "../ui/format";
import Table from "cli-table3";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  ownerUsername: string;
  createdAt: string;
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
async function useProject(id: string, json: boolean): Promise<void> {
  setConfigValue("project", id);
  if (json) {
    printJson({ project: id, set: true });
    return;
  }
  printSuccess(`Default project set to ${green(id)}.`, json);
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
    .description("Manage your ApiVault projects");

  projects
    .command("list")
    .alias("ls")
    .description("List all projects you are a member of")
    .action(async () => {
      await listProjects(json()).catch(handle);
    });

  projects
    .command("use <id>")
    .description("Set the default project in your global config")
    .action(async (id: string) => {
      await useProject(id, json()).catch(handle);
    });
}
