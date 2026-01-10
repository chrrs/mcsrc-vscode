import * as vscode from "vscode";
import { getDefinedClasses } from "../logic/MinecraftApi";
import { getDecompileResult } from "../logic/Decompiler";
import { performSearch } from "../logic/Search";

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

export class FSSearchProvider implements vscode.FileSearchProvider {
    version: string | null = null;

    async provideFileSearchResults(query: vscode.FileSearchQuery, options: vscode.FileSearchOptions, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
        if (this.version == null)
            return [];

        let classes = await getDefinedClasses(this.version);
        classes = performSearch(query.pattern, classes);
        return classes.map(c => vscode.Uri.from({ scheme: 'mcsrc', path: `/${this.version}/${c}.java` }));
    }
}

export class DecompiledFSProvider implements vscode.FileSystemProvider {
    private roots: Record<string, Promise<PackageNode>> = {};

    private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

    watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: string[]; }): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const [_, node] = await this.lookup(uri);

        return {
            type: node.kind === "package" ? vscode.FileType.Directory : vscode.FileType.File,
            size: 0, ctime: 0, mtime: 0,
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const [_, node] = await this.lookup(uri);

        if (node.kind !== "package")
            throw vscode.FileSystemError.FileNotADirectory(uri);

        return Object.values(node.children)
            .map(child => [
                child.name + (child.kind === "class" ? ".java" : ""),
                child.kind === "package" ? vscode.FileType.Directory : vscode.FileType.File
            ]);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const [version, node] = await this.lookup(uri);

        if (node.kind !== "class")
            throw vscode.FileSystemError.FileIsADirectory(uri);

        const result = await getDecompileResult(version, node.path);
        return new TextEncoder().encode(result.source);
    }

    createDirectory(_uri: vscode.Uri) { }
    writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean; }) { }
    delete(_uri: vscode.Uri, _options: { recursive: boolean; }) { }
    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }) { }

    private async lookup(uri: vscode.Uri): Promise<[string, TreeNode]> {
        const segments = uri.path
            .replace(/\.java$/, "")
            .split("/")
            .filter(Boolean);

        if (segments.length === 0)
            throw vscode.FileSystemError.Unavailable("No Minecraft version selected.");

        const version = segments[0];
        segments.splice(0, 1);

        let current: TreeNode = await this.ensureRoot(version);
        for (const segment of segments) {
            if (!current || !(current.kind === "package"))
                throw vscode.FileSystemError.FileNotFound(uri);
            current = current.children[segment];
        }

        if (!current)
            throw vscode.FileSystemError.FileNotFound(uri);

        return [version, current];
    }

    private async ensureRoot(version: string): Promise<PackageNode> {
        if (version in this.roots)
            return this.roots[version];

        this.roots[version] = getDefinedClasses(version).then(buildTree);
        return this.roots[version];
    }
}

function buildTree(classNames: string[]): PackageNode {
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

    return {
        kind: "package",
        name: "",
        path: "",
        children: roots,
    };
}