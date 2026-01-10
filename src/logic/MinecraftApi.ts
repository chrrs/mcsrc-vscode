import { openJar, streamJar, type Jar } from "../utils/Jar";

const CACHE_NAME = 'mcsrc-v1';
const VERSIONS_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

export interface VersionsList {
    versions: VersionListEntry[];
}

export interface VersionListEntry {
    id: string;
    type: string;
    url: string;
    time: string;
    releaseTime: string;
    sha1: string;
}

interface VersionManifest {
    id: string;
    downloads: {
        [key: string]: {
            url: string;
            sha1: string;
        };
    };
}

export interface MinecraftJar {
    version: string;
    jar: Jar;
}

export type ProgressCallback = (n: number) => void;

let minecraftVersions: Promise<VersionListEntry[]> | null = null;
export async function getMinecraftVersions(): Promise<VersionListEntry[]> {
    if (minecraftVersions !== null)
        return minecraftVersions;

    minecraftVersions = fetchVersions().then(it => it.versions);
    return minecraftVersions;
}

const classesCache: Record<string, string[]> = {};
export async function getDefinedClasses(versionId: string): Promise<string[]> {
    if (versionId in classesCache)
        return classesCache[versionId];

    const jar = await getMinecraftJar(versionId);
    const classes = Object.keys(jar.jar.entries)
        .filter(it => it.endsWith(".class") && !it.includes('$'))
        .map(it => it.replace(".class", ""));
    classesCache[versionId] = classes;
    return classes;
}

const jarCache: Record<string, Promise<MinecraftJar>> = {};
export async function getMinecraftJar(versionId: string, progress: ProgressCallback = () => { }): Promise<MinecraftJar> {
    if (versionId in jarCache)
        return jarCache[versionId];

    const entry = await getVersionEntryById(versionId);
    if (entry === undefined)
        throw new Error(`Unknown Minecraft version: ${versionId}`);

    const jar = downloadMinecraftJar(entry, progress);
    jarCache[versionId] = jar;
    return jar;
}

async function getJson<T>(url: string): Promise<T> {
    console.log(`Fetching JSON from ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch JSON from ${url}: ${response.statusText}`);
    }

    return response.json();
}

async function fetchVersions(): Promise<VersionsList> {
    const mojang = await getJson<VersionsList>(VERSIONS_URL);
    const filteredMojangVersions = mojang.versions.filter(v => {
        const match = v.id.match(/^(\d+)\.(\d+)/);
        if (!match) return false;
        const major = parseInt(match[1], 10);
        return major >= 26;
    });
    const versions = filteredMojangVersions
        .concat(EXPERIMENTAL_VERSIONS.versions)
        .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime));
    return {
        versions: versions
    };
}

async function fetchVersionManifest(version: VersionListEntry): Promise<VersionManifest> {
    return getJson<VersionManifest>(version.url);
}

async function getVersionEntryById(id: string): Promise<VersionListEntry | undefined> {
    return (await getMinecraftVersions()).find(v => v.id === id);
}

async function cachedFetch(url: string): Promise<Response> {
    if (caches === undefined) {
        return fetch(url);
    }

    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
        return cachedResponse;
    };

    const response = await fetch(url);
    if (response.ok) {
        cache.put(url, response.clone());
    }
    return response;
}

async function downloadMinecraftJar(version: VersionListEntry, progress: ProgressCallback): Promise<MinecraftJar> {
    console.log(`Downloading Minecraft jar for version: ${version.id}`);
    const versionManifest = await fetchVersionManifest(version);
    const response = await cachedFetch(versionManifest.downloads.client.url);
    if (!response.ok) {
        throw new Error(`Failed to download Minecraft jar: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body || total === 0) {
        const blob = await response.blob();
        const jar = await openJar(blob);
        progress(0);
        return { version: version.id, jar };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let receivedLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        const percent = Math.round((receivedLength / total) * 100);
        progress(percent);
    }

    const blob = new Blob(chunks);
    const jar = await openJar(blob);
    progress(1);
    return { version: version.id, jar };
}

// TODO add an option to stream the Minecraft jar, this may add additional latency but will remove the inital large download time
async function streamMinecraftJar(version: VersionListEntry): Promise<MinecraftJar> {
    const versionManifest = await fetchVersionManifest(version);
    const jar = await streamJar(versionManifest.downloads.client.url);
    return { version: version.id, jar };
}

// Hardcode as these are never going to change.
const EXPERIMENTAL_VERSIONS: VersionsList = {
    versions: [
        {
            id: "25w45a_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/25w45a_unobfuscated.json",
            time: "2025-11-04T14:07:08+00:00",
            releaseTime: "2025-11-04T14:07:08+00:00",
            sha1: "7a3c149f148b6aa5ac3af48c4f701adea7e5b615",
        },
        {
            id: "25w46a_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/25w46a_unobfuscated.json",
            time: "2025-11-11T13:20:54+00:00",
            releaseTime: "2025-11-11T13:20:54+00:00",
            sha1: "314ade2afeada364047798e163ef8e82427c69e1",
        },
        {
            id: "1.21.11-pre1_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-pre1_unobfuscated.json",
            time: "2025-11-19T08:30:46+00:00",
            releaseTime: "2025-11-19T08:30:46+00:00",
            sha1: "9c267f8dda2728bae55201a753cdd07b584709f1",
        },
        {
            id: "1.21.11-pre2_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-pre2_unobfuscated.json",
            time: "2025-11-21T12:07:21+00:00",
            releaseTime: "2025-11-21T12:07:21+00:00",
            sha1: "2955ce0af0512fdfe53ff0740b017344acf6f397",
        },
        {
            id: "1.21.11-pre3_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-pre3_unobfuscated.json",
            time: "2025-11-25T14:14:30+00:00",
            releaseTime: "2025-11-25T14:14:30+00:00",
            sha1: "579bf3428f72b5ea04883d202e4831bfdcb2aa8d",
        },
        {
            id: "1.21.11-pre4_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-pre4_unobfuscated.json",
            time: "2025-12-01T13:40:12+00:00",
            releaseTime: "2025-12-01T13:40:12+00:00",
            sha1: "410ce37a2506adcfd54ef7d89168cfbe89cac4cb",
        },
        {
            id: "1.21.11-pre5_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-pre5_unobfuscated.json",
            time: "2025-12-03T13:34:06+00:00",
            releaseTime: "2025-12-03T13:34:06+00:00",
            sha1: "1028441ca6d288bbf2103e773196bf524f7260fd",
        },
        {
            id: "1.21.11-rc1_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-rc1_unobfuscated.json",
            time: "2025-12-04T15:56:55+00:00",
            releaseTime: "2025-12-04T15:56:55+00:00",
            sha1: "5d3ee0ef1f0251cf7e073354ca9e085a884a643d",
        },
        {
            id: "1.21.11-rc2_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-rc2_unobfuscated.json",
            time: "2025-12-05T11:57:45+00:00",
            releaseTime: "2025-12-05T11:57:45+00:00",
            sha1: "9282a3fb154d2a425086c62c11827281308bf93b",
        },
        {
            id: "1.21.11-rc3_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11-rc3_unobfuscated.json",
            time: "2025-12-08T13:59:34+00:00",
            releaseTime: "2025-12-08T13:59:34+00:00",
            sha1: "ce3f7ac6d0e9d23ea4e5f0354b91ff15039d9931",
        },
        {
            id: "1.21.11_unobfuscated",
            type: "unobfuscated",
            url: "https://maven.fabricmc.net/net/minecraft/1_21_11_unobfuscated.json",
            time: "2025-12-09T12:43:15+00:00",
            releaseTime: "2025-12-09T12:43:15+00:00",
            sha1: "327be7759157b04495c591dbb721875e341877af",
        }
    ]
};