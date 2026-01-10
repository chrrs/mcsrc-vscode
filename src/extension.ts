import * as vscode from "vscode";
import { DecompiledFSProvider, FSSearchProvider } from "./ext/FileProviders";
import { DecompiledDefinitionProvider, DecompiledHoverProvider, DecompiledSemanticTokensProvider, tokenLegend } from "./ext/TokenProviders";
import { getMinecraftVersions, type VersionListEntry } from "./logic/MinecraftApi";

// Some resources on deploying vscode-web:
// https://gist.github.com/progrium/76fac3c76f12e0875469629ec703aab9
// https://update.code.visualstudio.com/api/update/web-standalone/stable/latest
// https://github.com/Felx-B/vscode-web

class VersionTreeDataProvider implements vscode.TreeDataProvider<string> {
    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

    private currentVersion: string | null = null;
    private versions: VersionListEntry[] | null = null;

    async setVersion(version: string | null) {
        this.currentVersion = version;
        this.onDidChangeEmitter.fire();

        if (this.versions === null) {
            this.versions = await getMinecraftVersions();
            this.onDidChangeEmitter.fire();
        }
    }

    getTreeItem(element: string): vscode.TreeItem {
        const item = new vscode.TreeItem(
            element,
            vscode.TreeItemCollapsibleState.None
        );

        item.command = {
            command: "mcsrc.changeVersion",
            title: "Change Minecraft Version",
            arguments: [element]
        };
        item.iconPath = new vscode.ThemeIcon("versions");

        return item;
    }

    getChildren(): string[] {
        return this.versions
            ? this.versions.map(v => v.id)
            : this.currentVersion
                ? [this.currentVersion]
                : [];
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const fsProvider = vscode.workspace.registerFileSystemProvider("mcsrc", new DecompiledFSProvider(), { isReadonly: true, isCaseSensitive: true });
    context.subscriptions.push(fsProvider);

    const searchProvider = new FSSearchProvider();
    context.subscriptions.push(vscode.workspace.registerFileSearchProvider("mcsrc", searchProvider));

    const versionProvider = new VersionTreeDataProvider();
    const versionTreeView = vscode.window.createTreeView("mcsrc.version", {
        treeDataProvider: versionProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(versionTreeView);

    const ensureWorkspaceFolder = (version: string) => {
        const uri = vscode.Uri.from({ scheme: "mcsrc", path: `/${version}` });
        const folders = vscode.workspace.workspaceFolders ?? [];
        vscode.workspace.updateWorkspaceFolders(0, folders.length, { uri, name: version });
        console.log('changed workspace to', version);
    };

    let acceptedEula = false;
    const selectVersion = async (version: string) => {
        if (!acceptedEula) {
            await promptEula();
            acceptedEula = true;
        }

        ensureWorkspaceFolder(version);
        await context.globalState.update("mcsrc.selectedVersion", version);
        versionProvider.setVersion(version);
        versionTreeView.description = version ?? undefined;
        searchProvider.version = version;
    };

    const changeVersion = vscode.commands.registerCommand("mcsrc.changeVersion", async (version?: string) => {
        try {
            if (version === undefined) {
                const picks = (await getMinecraftVersions()).map(v => ({
                    label: v.id,
                    description: v.type,
                    detail: v.releaseTime
                }));

                const pick = await vscode.window.showQuickPick(picks, {
                    placeHolder: "Select Minecraft version"
                });
                if (!pick) return;
                version = pick.label;
            }

            await selectVersion(version);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load versions: ${String(error)}`);
        }
    });
    context.subscriptions.push(changeVersion);

    const ensureLanguage = vscode.workspace.onDidOpenTextDocument(doc => {
        if ((doc.uri.scheme === "mcsrc") && doc.languageId !== "java") {
            void vscode.languages.setTextDocumentLanguage(doc, "java");
        }
    });
    context.subscriptions.push(ensureLanguage);

    const tokenProvider = vscode.languages.registerDocumentSemanticTokensProvider(
        { scheme: "mcsrc", language: "java" },
        new DecompiledSemanticTokensProvider(),
        tokenLegend
    );
    context.subscriptions.push(tokenProvider);

    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: "mcsrc", language: "java" },
        new DecompiledHoverProvider()
    );
    context.subscriptions.push(hoverProvider);

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        { scheme: "mcsrc", language: "java" },
        new DecompiledDefinitionProvider()
    );
    context.subscriptions.push(definitionProvider);

    void (async () => {
        try {
            const selectedVersion = context.globalState.get<string>("mcsrc.selectedVersion");
            if (selectedVersion) {
                await selectVersion(selectedVersion);
            } else {
                await selectVersion("26.1-snapshot-2");
            }
        } catch (error) {
            console.error("failed to initialize MCSRC extension", error);
            vscode.window.showErrorMessage(`Failed to initialize MCSRC extension: ${String(error)}`);
        }
    })();
}

export function deactivate(): void {
    // no-op
}

async function promptEula() {
    while (true) {
        const message = `
        NOTE! This website is not redistributing any Minecraft code or compiled bytecode. The minecraft jar is downloaded directly from Mojang's servers to your device when you use this tool. Check your browser's network requests!

        The Vineflower decompiler is used after being compiled to wasm as part of the @run-slicer/vf project.

        By continuing, you agree to the Minecraft EULA.
        `;

        const choice = await vscode.window.showInformationMessage(
            message, { modal: true }, "Accept EULA", "Open EULA"
        );

        if (choice === "Accept EULA") {
            location;
            return;
        } else if (choice === "Open EULA") {
            await vscode.env.openExternal(vscode.Uri.parse("https://www.minecraft.net/en-us/eula"));
        }
    }
}

