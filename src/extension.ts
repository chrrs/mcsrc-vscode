import * as vscode from "vscode";
import { ClassesTreeDataProvider } from "./classesView";
import { getMinecraftVersions } from "./logic/MinecraftApi";
import { getDecompileResult } from "./logic/Decompiler";

// Some resources on deploying vscode-web:
// https://gist.github.com/progrium/76fac3c76f12e0875469629ec703aab9
// https://update.code.visualstudio.com/api/update/web-standalone/stable/latest
// https://github.com/Felx-B/vscode-web

class McsrcContentProvider implements vscode.TextDocumentContentProvider {
    readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const version = uri.authority;
        const classPath = uri.path.replace(/^\//, "");

        if (!version || !classPath) {
            return "// Invalid URI. Expected mcsrc://<version>/<classPath>";
        }

        return (await getDecompileResult(version, classPath)).source;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const provider = new McsrcContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("mcsrc", provider)
    );

    let acceptedEula = false;
    let currentVersion: string | undefined = undefined;
    const selectVersion = async (version: string) => {
        if (!acceptedEula) {
            await promptEula();
            acceptedEula = true;
        }

        currentVersion = version;
        await context.globalState.update("mcsrc.selectedVersion", version);
        classesProvider.setVersion(version);
        classesTreeView.description = version ?? undefined;
    };

    const classesProvider = new ClassesTreeDataProvider();
    const classesTreeView = vscode.window.createTreeView("mcsrc.classes", {
        treeDataProvider: classesProvider
    });
    context.subscriptions.push(classesTreeView);

    const changeVersion = vscode.commands.registerCommand("mcsrc.changeVersion", async () => {
        try {
            const picks = (await getMinecraftVersions()).map(v => ({
                label: v.id,
                description: v.type,
                detail: v.releaseTime
            }));

            const pick = await vscode.window.showQuickPick(picks, {
                placeHolder: "Select Minecraft version"
            });
            if (!pick) return;

            await selectVersion(pick.label);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load versions: ${String(error)}`);
        }
    });
    context.subscriptions.push(changeVersion);

    const openClass = vscode.commands.registerCommand("mcsrc.openClass", async (version?: string, classPath?: string) => {
        if (!classPath) {
            const pick = await vscode.window.showInputBox({ prompt: "Class name" });
            classPath = pick?.replaceAll(".", "/");
        }

        version = version ?? currentVersion;
        if (!version || !classPath)
            return;

        const uri = vscode.Uri.parse(`mcsrc://${version}/${classPath}`);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false });
    });
    context.subscriptions.push(openClass);

    const ensureLanguage = vscode.workspace.onDidOpenTextDocument(doc => {
        if ((doc.uri.scheme === "mcsrc") && doc.languageId !== "java") {
            void vscode.languages.setTextDocumentLanguage(doc, "java");
        }
    });
    context.subscriptions.push(ensureLanguage);

    void (async () => {
        try {
            const selectedVersion = context.globalState.get<string>("mcsrc.selectedVersion");
            if (selectedVersion) {
                await selectVersion(selectedVersion);
            } else {
                await selectVersion("21.6-snapshot-2");
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

