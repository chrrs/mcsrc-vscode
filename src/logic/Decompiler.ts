/* eslint-disable @typescript-eslint/no-unused-vars */
import { getMinecraftJar } from "./MinecraftApi";
import { decompile, type Options, type TokenCollector } from "./vf";
import type { Jar } from "../utils/Jar";
import type { Token } from "./Tokens";
// import { getBytecode } from "../workers/UsageIndex";

export interface DecompileResult {
    className: string;
    source: string;
    tokens: Token[];
    language: 'java' | 'bytecode';
}

const DECOMPILER_OPTIONS: Options = {};

const decompilationCache = new Map<string, DecompileResult>();
export async function getDecompileResult(versionId: string, className: string) {
    const jar = await getMinecraftJar(versionId);

    const fileName = className + ".class";
    if (!(fileName in jar.jar.entries)) {
        console.error(`Class not found in Minecraft jar: ${className}`);
        return { className, source: `// Class not found: ${className}`, tokens: [], language: "java" };
    }

    // if (bytecode) {
    //     return await getClassBytecode(className, jar.jar);
    // }

    let key = `${jar.version}:${className}`;

    // if (displayLambdas) {
    //     key += ":lambdas";
    // }

    const cached = decompilationCache.get(key);
    if (cached) {
        // Re-insert at end
        decompilationCache.delete(key);
        decompilationCache.set(key, cached);

        return cached;
    }

    let options = { ...DECOMPILER_OPTIONS };

    // if (displayLambdas) {
    //     options["mark-corresponding-synthetics"] = "1";
    // }

    const result = await decompileClass(className, jar.jar, options);
    if (decompilationCache.size >= 75) {
        const firstKey = decompilationCache.keys().next().value;
        if (firstKey) decompilationCache.delete(firstKey);
    }
    decompilationCache.set(key, result);
    return result;
}

async function decompileClass(className: string, jar: Jar, options: Options): Promise<DecompileResult> {
    console.log(`Decompiling class: '${className}'`);

    const files = Object.keys(jar.entries);

    try {
        const tokens: Token[] = [];
        const source = await decompile(className, {
            source: async (name: string) => {
                const file = jar.entries[name + ".class"];
                if (file) {
                    const arrayBuffer = await file.bytes();
                    return new Uint8Array(arrayBuffer);
                }

                console.error(`File not found in Minecraft jar: ${name}`);
                return null;
            },
            resources: files.filter(f => f.endsWith('.class')).map(f => f.replace(".class", "")),
            options,
            tokenCollector: tokenCollector(tokens)
        });

        tokens.push(...generateImportTokens(source));
        tokens.sort((a, b) => a.start - b.start);

        return { className, source, tokens, language: "java" };
    } catch (e) {
        console.error(`Error during decompilation of class '${className}':`, e);
        return { className, source: `// Error during decompilation: ${(e as Error).message}`, tokens: [], language: "java" };
    }
}

function tokenCollector(tokens: Token[]): TokenCollector {
    return {
        start: function (content: string): void {
        },
        visitClass: function (start: number, length: number, declaration: boolean, name: string): void {
            tokens.push({ type: "class", start, length, className: name, declaration });
        },
        visitField: function (start: number, length: number, declaration: boolean, className: string, name: string, descriptor: string): void {
            tokens.push({ type: "field", start, length, className, declaration, name, descriptor });
        },
        visitMethod: function (start: number, length: number, declaration: boolean, className: string, name: string, descriptor: string): void {
            tokens.push({ type: "method", start, length, className, declaration, name, descriptor });
        },
        visitParameter: function (start: number, length: number, declaration: boolean, className: string, methodName: string, methodDescriptor: string, index: number, name: string): void {
            tokens.push({ type: "parameter", start, length, className, declaration });
        },
        visitLocal: function (start: number, length: number, declaration: boolean, className: string, methodName: string, methodDescriptor: string, index: number, name: string): void {
            tokens.push({ type: "local", start, length, className, declaration });
        },
        end: function (): void {
        }
    };
}

function generateImportTokens(source: string): Token[] {
    const importTokens: Token[] = [];

    const importRegex = /^\s*import\s+(?!static\b)([^\s;]+)\s*;/gm;

    let match = null;
    while ((match = importRegex.exec(source)) !== null) {
        const importPath = match[1].replaceAll('.', '/');
        if (importPath.endsWith('*')) {
            continue;
        }

        const className = importPath.substring(importPath.lastIndexOf('/') + 1);

        importTokens.push({
            type: "class",
            start: match.index + match[0].lastIndexOf(className),
            length: importPath.length - importPath.lastIndexOf(className),
            className: importPath,
            declaration: false
        });
    }
    return importTokens;
}

// async function getClassBytecode(className: string, jar: Jar): Promise<DecompileResult> {
//     var classData = [];
//     const allClasses = Object.keys(jar.entries).filter(f => f.endsWith('.class')).sort();

//     const fileName = className + ".class";

//     try {
//         const data = await jar.entries[fileName].bytes();
//         classData.push(data.buffer);

//         for (const classFile of allClasses) {
//             if (!classFile.startsWith(className + "$")) {
//                 continue;
//             }

//             const data = await jar.entries[classFile].bytes();
//             classData.push(data.buffer);
//         }

//         const bytecode = await getBytecode(classData);
//         return { className, source: bytecode, tokens: [], language: "bytecode" };
//     } catch (e) {
//         console.error(`Error during bytecode retrieval of class '${className}':`, e);
//         return { className, source: `// Error during bytecode retrieval: ${(e as Error).message}`, tokens: [], language: "bytecode" };
//     }
// }