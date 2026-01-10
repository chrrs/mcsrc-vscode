import * as vscode from "vscode";
import { getDefinedClasses, getMinecraftJar } from "./logic/MinecraftApi";

type TreeNode = PackageNode | ClassNode;

interface PackageNode {
    kind: "package";
    name: string;
    path: string;
    children: Record<string, TreeNode>;
};

interface ClassNode {
    kind: "class";
    name: string;
    path: string;
};

export class ClassesTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private version: string | null = null;
    private roots: TreeNode[] | null = null;

    // With this, we notify VSCode of changes.
    private readonly onDidChangeEmitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

    setVersion(version: string | null): void {
        this.version = version;
        this.roots = null;
        this.onDidChangeEmitter.fire(undefined);
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (!this.version) {
            return [];
        } else if (element) {
            return element.kind === "package" ? sortNodes(Object.values(element.children)) : [];
        } else {
            return this.getRootNodes(this.version);
        }
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        if (element.kind === "package") {
            const item = new vscode.TreeItem(
                element.name,
                vscode.TreeItemCollapsibleState.Collapsed
            );

            item.id = `${this.version}:${element.path}`;
            item.contextValue = "mcsrc.package";
            item.iconPath = vscode.ThemeIcon.Folder;

            return item;
        } else {
            const item = new vscode.TreeItem(
                element.name,
                vscode.TreeItemCollapsibleState.None
            );

            item.id = `${this.version}:${element.path}`;
            item.contextValue = "mcsrc.class";
            item.resourceUri = vscode.Uri.parse(`mcsrc://${this.version}/${element.path}`);
            item.iconPath = vscode.ThemeIcon.File;

            item.command = {
                command: "mcsrc.openClass",
                title: "Open Class",
                arguments: [this.version, element.path]
            };

            return item;
        }
    }

    private async getRootNodes(version: string): Promise<TreeNode[]> {
        if (this.roots !== null)
            return this.roots;

        const classes = await getDefinedClasses(version);
        this.roots = buildTree(classes);
        return this.roots;
    }
}

function buildTree(classNames: string[]): TreeNode[] {
    const roots: Record<string, TreeNode> = {};

    for (const classPath of classNames) {
        const segments = classPath.split("/");
        const className = segments.pop();

        if (!className)
            continue;

        let parent: PackageNode | undefined;
        for (const segment of segments) {
            const children = parent ? parent.children : roots;

            if (!(segment in children)) {
                children[segment] = {
                    kind: "package",
                    name: segment,
                    path: parent ? `${parent.path}/${segment}` : segment,
                    children: {},
                };
            }

            if (children[segment].kind === "package") {
                parent = children[segment];
            } else {
                throw new Error(`Class '${children[segment].path}' conflicts with a package!`);
            }
        }

        (parent?.children ?? roots)[className] = {
            kind: "class",
            name: className,
            path: classPath
        };
    }

    return Object.values(roots);
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "package" ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}