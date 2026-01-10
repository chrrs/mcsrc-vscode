import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import * as path from "path";

export default defineConfig({
    build: {
        lib: {
            entry: "./src/extension.ts",
            formats: ["cjs"],
            fileName: (_format, name) => `mcsrc/dist/web/${name}.js`,
        },
        rollupOptions: {
            external: ["vscode"],
        },
        sourcemap: true,
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    src: path.resolve(__dirname, './package.json'),
                    dest: './mcsrc',
                },
                {
                    src: path.resolve(__dirname, './node_modules/vscode-web/dist') + '/[!.]*',
                    dest: './vscode-web',
                }
            ],
            watch: {
                reloadPageOnChange: true
            }
        }),
    ]
});
