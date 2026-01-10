import * as vscode from "vscode";
import { getDecompileResult, type DecompileResult } from "../logic/Decompiler";
import type { Token } from "../logic/Tokens";
import { getDefinedClasses } from "../logic/MinecraftApi";

const tokenTypes = ["class", "method", "property", "parameter", "variable"];
const tokenModifiers = ["declaration"];
export const tokenLegend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

function parseDocumentPath(document: vscode.TextDocument): [string, string] | null {
    const segments = document.uri.path
        .replace(/\.java$/, "")
        .split("/")
        .filter(Boolean);
    if (segments.length === 0)
        return null;

    const [version, ...classSegments] = segments;
    if (classSegments.length === 0)
        return null;
    const className = classSegments.join("/");

    return [version, className];
}

async function getDocumentDecompileResult(document: vscode.TextDocument): Promise<DecompileResult | null> {
    const parsed = parseDocumentPath(document);

    if (parsed == null)
        return null;

    return await getDecompileResult(parsed[0], parsed[1]);
}

function toSemanticType(token: Token): typeof tokenTypes[number] {
    switch (token.type) {
        case "class":
            return "class";
        case "method":
            return "method";
        case "field":
            return "property";
        case "parameter":
            return "parameter";
        case "local":
            return "variable";
    }
}

export class DecompiledSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    async provideDocumentSemanticTokens(document: vscode.TextDocument, cancellationToken: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        const result = await getDocumentDecompileResult(document);
        if (result == null)
            return new vscode.SemanticTokens(new Uint32Array());

        const builder = new vscode.SemanticTokensBuilder(tokenLegend);

        const text = document.getText();
        for (const token of result.tokens) {
            // If we have a fully qualified path, only mark the actual type name.
            const tokenText = text.substring(token.start, token.start + token.length);
            const offset = tokenText.lastIndexOf(".") + 1;

            const semanticType = toSemanticType(token);
            const position = document.positionAt(token.start + offset);
            builder.push(position.line, position.character, token.length - offset,
                tokenTypes.indexOf(semanticType), token.declaration ? 1 : 0);
        }

        return builder.build();
    }
}

export class DecompiledHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        const result = await getDocumentDecompileResult(document);
        if (result == null)
            return undefined;

        const offset = document.offsetAt(position);
        const matches = result.tokens.filter(token => offset >= token.start && offset < token.start + token.length);
        if (matches.length === 0) return undefined;

        const first = matches[0];
        const range = new vscode.Range(
            document.positionAt(first.start),
            document.positionAt(first.start + first.length)
        );

        return new vscode.Hover(JSON.stringify(first), range);
    }
}

export class DecompiledDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken): Promise<vscode.Location | undefined> {
        const parsed = parseDocumentPath(document);
        if (!parsed)
            return undefined;

        const [version, className] = parsed;
        const result = await getDecompileResult(version, className);

        // First, we need to find the token we've hovered over.
        const offset = document.offsetAt(position);
        const target = result.tokens.find(token => offset >= token.start && offset < token.start + token.length);

        if (!target || target.declaration || cancellationToken.isCancellationRequested)
            return undefined;

        let targetClassName = target.className;
        if (targetClassName.includes("$"))
            targetClassName = targetClassName.substring(0, targetClassName.indexOf("$"));

        // Then, let's check if it actually points to a class we have.
        const classes = await getDefinedClasses(version);
        if (!classes.includes(targetClassName))
            return undefined;

        if (target.type !== "field" && target.type !== "method" && target.type !== "class")
            return undefined;

        // Next, we read the target file to find the exact declaration.
        const targetResult = await getDecompileResult(version, targetClassName);

        let decToken: Token | undefined;
        if (target.type === "class") {
            decToken = targetResult.tokens.find(token =>
                token.declaration && token.type == target.type && token.className === target.className);
        } else if (target.type === "field" || target.type === "method") {
            decToken = targetResult.tokens.find(token =>
                token.declaration && token.type == target.type && token.name === target.name);
        }

        // If we have a declaration, calculate the line/col.
        let targetPos: vscode.Position | vscode.Range = new vscode.Position(0, 0);
        if (decToken !== undefined) {
            const start = decToken.start;
            const end = start + decToken.length;

            let curLine = 0, lineStart = 0;
            let startLine = 0, startCol = 0;

            for (let i = 0; i < end; i++) {
                if (i === start) {
                    startLine = curLine;
                    startCol = i - lineStart;
                }

                if (targetResult.source.charCodeAt(i) === 10) {
                    curLine++;
                    lineStart = i + 1;
                }
            }

            targetPos = new vscode.Range(
                new vscode.Position(startLine, startCol),
                new vscode.Position(curLine, end - lineStart)
            );
        }

        return new vscode.Location(
            vscode.Uri.from({ scheme: "mcsrc", path: `/${version}/${targetClassName}.java` }),
            targetPos,
        );
    }
}

