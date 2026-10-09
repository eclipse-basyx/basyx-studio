import { spawn as e } from "node:child_process";
import { randomBytes as t } from "node:crypto";
import { existsSync as n } from "node:fs";
import { mkdir as r, readFile as i, writeFile as a } from "node:fs/promises";
import { createServer as o } from "node:net";
import { join as s } from "node:path";
import { BrowserWindow as c, app as l, dialog as u, ipcMain as d, protocol as f, safeStorage as p, session as m, shell as h } from "electron";
//#region electron/main.ts
var g = "X-Studio-Launch-Secret", _ = "X-Studio-Broker-Secret", v = "127.0.0.1", y = 15e3, b = [{
	name: "AASX package",
	extensions: ["aasx"]
}], x = "studio-app", S = /^app-[0-9a-f]{16}$/;
f.registerSchemesAsPrivileged([{
	scheme: x,
	privileges: {
		standard: !0,
		secure: !0,
		supportFetchAPI: !0,
		corsEnabled: !0
	}
}]);
var C = process.env.STUDIO_BROKER_SECRET ?? t(32).toString("base64url"), w, T, E, D = !1;
function O(e) {
	let t = new URL(e), n = /* @__PURE__ */ new Set([
		"127.0.0.1",
		"::1",
		"localhost"
	]);
	if (t.protocol !== "http:" || !n.has(t.hostname)) throw Error("The Electron development server URL must use HTTP on loopback.");
	return t.href;
}
async function k() {
	let e = o();
	await new Promise((t, n) => {
		e.once("error", n), e.listen(0, v, t);
	});
	let t = e.address();
	if (!t || typeof t == "string") throw e.close(), Error("Could not allocate a loopback port for the Studio Service.");
	let n = t.port;
	return await new Promise((t, n) => {
		e.close((e) => e ? n(e) : t());
	}), n;
}
async function A(e, t, n) {
	let r = Date.now() + y, i, a = (e) => {
		i = e;
	};
	n.once("error", a);
	try {
		for (; Date.now() < r;) {
			if (i) throw i;
			if (n.exitCode !== null) throw Error(`The Studio Service exited during startup with code ${n.exitCode}.`);
			try {
				if ((await fetch(e, {
					headers: { [g]: t },
					signal: AbortSignal.timeout(1e3)
				})).ok) return;
			} catch {}
			await new Promise((e) => setTimeout(e, 100));
		}
	} finally {
		n.off("error", a);
	}
	throw Error("Timed out while starting the local Studio Service.");
}
async function j() {
	if (!p.isEncryptionAvailable()) throw Error("The operating system credential store is not available.");
	if (process.platform === "linux" && p.getSelectedStorageBackend() === "basic_text") throw Error("No supported credential store (libsecret or kwallet) was found. BaSyx Studio does not store keys in plain text.");
	let e = s(l.getPath("userData"), "data-key.bin");
	if (n(e)) return p.decryptString(await i(e));
	let o = t(32).toString("base64url");
	return await r(l.getPath("userData"), { recursive: !0 }), await a(e, p.encryptString(o), { mode: 384 }), o;
}
async function M() {
	let r = s(l.getAppPath(), ".output", "server", "index.mjs");
	if (!n(r)) throw Error("The packaged Studio Service entry point is missing.");
	let i = await k(), a = t(32).toString("base64url"), o = `http://${v}:${i}/`, c = await j();
	return E = e(process.execPath, [r], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_HOST: v,
			NITRO_PORT: String(i),
			NUXT_STUDIO_DEPLOYMENT_MODE: "desktop",
			STUDIO_DATA_DIR: s(l.getPath("userData"), "studio-data"),
			STUDIO_DATA_KEY: c,
			STUDIO_LAUNCH_SECRET: a,
			STUDIO_BROKER_SECRET: C,
			STUDIO_DENO_PATH: s(process.resourcesPath, "deno", process.platform === "win32" ? "deno.exe" : "deno")
		},
		stdio: [
			"ignore",
			"inherit",
			"inherit"
		]
	}), await A(o, a, E), E.once("exit", (e, t) => {
		D || (u.showErrorBox("BaSyx Studio Service stopped", `The local Studio Service exited unexpectedly (${t ?? e ?? "unknown reason"}).`), l.quit());
	}), {
		launchSecret: a,
		url: o
	};
}
var N = /* @__PURE__ */ new WeakSet();
function P(e, t, n) {
	if (N.has(e)) return;
	N.add(e);
	let r = new URL(t).origin;
	e.protocol.handle(x, async (e) => {
		let r = new URL(e.url);
		if (e.method !== "GET" || !S.test(r.hostname)) return new Response(null, { status: 404 });
		let i = await fetch(new URL(`app/${r.hostname}${r.pathname}`, t), { headers: {
			[_]: C,
			...n ? { [g]: n } : {}
		} }), a = new Headers(i.headers);
		return a.delete("content-encoding"), a.delete("content-length"), new Response(i.body, {
			status: i.status,
			headers: a
		});
	}), e.setPermissionRequestHandler((e, t, n, i) => {
		n(new URL(i.requestingUrl).origin === r);
	}), e.setPermissionCheckHandler((e, t, n) => n === r);
}
function F(e, t) {
	let n = new URL(t).origin;
	e.webContents.on("will-frame-navigate", (e) => {
		if (e.isMainFrame) return;
		let t = new URL(e.url), r = e.frame?.url ? new URL(e.frame.url) : null;
		t.origin !== n && (t.protocol !== `${x}:` || r?.protocol === `${x}:` && r.hostname !== t.hostname) && e.preventDefault();
	});
}
async function I(e, t) {
	let n = m.fromPartition("studio");
	P(n, e, t), t && n.webRequest.onBeforeSendHeaders({ urls: [`${e}*`] }, (e, n) => {
		n({ requestHeaders: {
			...e.requestHeaders,
			[g]: t
		} });
	});
	let r = new c({
		show: !1,
		title: "BaSyx Studio",
		webPreferences: {
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0,
			session: n,
			preload: s(import.meta.dirname, "preload.cjs")
		}
	});
	B(r), F(r, e);
	let i = new URL(e).origin;
	r.webContents.on("will-navigate", (e, t) => {
		new URL(t).origin !== i && e.preventDefault();
	}), r.webContents.setWindowOpenHandler(({ url: e }) => {
		let t = new URL(e).protocol;
		return (t === "https:" || t === "http:") && h.openExternal(e), { action: "deny" };
	}), r.once("ready-to-show", () => r.show()), await r.loadURL(e), l.isPackaged || r.webContents.openDevTools();
}
async function L(e, t = {}) {
	if (!w) throw Error("The Studio Service is not running.");
	let n = await fetch(new URL(`api/studio/v1/${e}`, w), {
		method: t.method ?? "GET",
		headers: {
			[_]: C,
			...T ? { [g]: T } : {},
			...t.body === void 0 ? {} : { "Content-Type": "application/json" }
		},
		body: t.body === void 0 ? void 0 : JSON.stringify(t.body),
		signal: AbortSignal.timeout(1e4)
	});
	if (!n.ok) throw Error(`The Studio Service answered with HTTP ${n.status}.`);
	return await n.json();
}
function R(e) {
	let t = e.senderFrame;
	return !!(w && t && t === e.sender.mainFrame && new URL(t.url).origin === new URL(w).origin);
}
function z() {
	d.handle("studio:choose-aasx-file", async (e) => {
		if (!R(e)) throw Error("Untrusted sender.");
		let t = c.fromWebContents(e.sender), n = {
			properties: ["openFile"],
			filters: b
		}, r = t ? await u.showOpenDialog(t, n) : await u.showOpenDialog(n);
		return r.canceled || !r.filePaths[0] ? null : L("desktop/file-grants", {
			method: "POST",
			body: {
				path: r.filePaths[0],
				purpose: "open"
			}
		});
	}), d.handle("studio:choose-save-location", async (e, t) => {
		if (!R(e)) throw Error("Untrusted sender.");
		let n = c.fromWebContents(e.sender), r = {
			defaultPath: typeof t == "string" ? t.replaceAll(/[/\\]/g, "_") : void 0,
			filters: b
		}, i = n ? await u.showSaveDialog(n, r) : await u.showSaveDialog(r);
		return i.canceled || !i.filePath ? null : L("desktop/file-grants", {
			method: "POST",
			body: {
				path: i.filePath.toLowerCase().endsWith(".aasx") ? i.filePath : `${i.filePath}.aasx`,
				purpose: "save"
			}
		});
	});
}
function B(e) {
	let t = !1;
	e.on("close", (n) => {
		if (t) return;
		n.preventDefault();
		let r = D;
		L("desktop/state").then((e) => e.unsavedWorkspaces).catch(() => []).then(async (n) => {
			if (n.length > 0) {
				let { response: t } = await u.showMessageBox(e, {
					type: "warning",
					buttons: ["Cancel", "Close without saving"],
					defaultId: 0,
					cancelId: 0,
					message: "Some packages have unsaved changes.",
					detail: n.join("\n")
				});
				if (t !== 1) {
					D = !1;
					return;
				}
			}
			t = !0, r ? l.quit() : e.close();
		});
	});
}
async function V() {
	z();
	let e = process.env.VITE_DEV_SERVER_URL;
	if (!l.isPackaged) {
		if (!e) throw Error("The Electron development server URL is missing.");
		w = O(e), await I(w);
		return;
	}
	let t = await M();
	w = t.url, T = t.launchSecret, await I(w, T);
}
function H(e) {
	let t = e instanceof Error ? e.message : "Unknown startup error.";
	u.showErrorBox("BaSyx Studio could not start", t), l.quit();
}
process.env.STUDIO_USER_DATA_DIR && l.setPath("userData", process.env.STUDIO_USER_DATA_DIR), l.requestSingleInstanceLock() ? (l.on("second-instance", () => {
	let [e] = c.getAllWindows();
	e && (e.isMinimized() && e.restore(), e.focus());
}), l.whenReady().then(V).catch(H)) : l.quit(), l.on("activate", () => {
	c.getAllWindows().length === 0 && w && I(w, T).catch(H);
}), l.on("before-quit", () => {
	D = !0;
}), l.on("will-quit", () => {
	E?.kill(), E = void 0;
}), l.on("window-all-closed", () => {
	process.platform !== "darwin" && l.quit();
});
//#endregion
export {};
