import { spawn as e } from "node:child_process";
import { randomBytes as t } from "node:crypto";
import { existsSync as n } from "node:fs";
import { createServer as r } from "node:net";
import { join as i } from "node:path";
import { BrowserWindow as a, app as o, dialog as s, session as c } from "electron";
//#region electron/main.ts
var l = "X-Studio-Launch-Secret", u = "127.0.0.1", d = 15e3, f, p, m, h = !1;
function g(e) {
	let t = new URL(e), n = /* @__PURE__ */ new Set([
		"127.0.0.1",
		"::1",
		"localhost"
	]);
	if (t.protocol !== "http:" || !n.has(t.hostname)) throw Error("The Electron development server URL must use HTTP on loopback.");
	return t.href;
}
async function _() {
	let e = r();
	await new Promise((t, n) => {
		e.once("error", n), e.listen(0, u, t);
	});
	let t = e.address();
	if (!t || typeof t == "string") throw e.close(), Error("Could not allocate a loopback port for the Studio Service.");
	let n = t.port;
	return await new Promise((t, n) => {
		e.close((e) => e ? n(e) : t());
	}), n;
}
async function v(e, t, n) {
	let r = Date.now() + d, i, a = (e) => {
		i = e;
	};
	n.once("error", a);
	try {
		for (; Date.now() < r;) {
			if (i) throw i;
			if (n.exitCode !== null) throw Error(`The Studio Service exited during startup with code ${n.exitCode}.`);
			try {
				if ((await fetch(e, {
					headers: { [l]: t },
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
async function y() {
	let r = i(o.getAppPath(), ".output", "server", "index.mjs");
	if (!n(r)) throw Error("The packaged Studio Service entry point is missing.");
	let a = await _(), c = t(32).toString("base64url"), l = `http://${u}:${a}/`;
	return m = e(process.execPath, [r], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_HOST: u,
			NITRO_PORT: String(a),
			STUDIO_LAUNCH_SECRET: c
		},
		stdio: [
			"ignore",
			"inherit",
			"inherit"
		]
	}), await v(l, c, m), m.once("exit", (e, t) => {
		h || (s.showErrorBox("BaSyx Studio Service stopped", `The local Studio Service exited unexpectedly (${t ?? e ?? "unknown reason"}).`), o.quit());
	}), {
		launchSecret: c,
		url: l
	};
}
async function b(e, t) {
	let n = c.fromPartition("studio");
	t && n.webRequest.onBeforeSendHeaders({ urls: [`${e}*`] }, (e, n) => {
		n({ requestHeaders: {
			...e.requestHeaders,
			[l]: t
		} });
	});
	let r = new a({
		show: !1,
		title: "BaSyx Studio",
		webPreferences: {
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0,
			session: n
		}
	}), i = new URL(e).origin;
	r.webContents.on("will-navigate", (e, t) => {
		new URL(t).origin !== i && e.preventDefault();
	}), r.webContents.setWindowOpenHandler(() => ({ action: "deny" })), r.once("ready-to-show", () => r.show()), await r.loadURL(e), o.isPackaged || r.webContents.openDevTools();
}
async function x() {
	let e = process.env.VITE_DEV_SERVER_URL;
	if (!o.isPackaged) {
		if (!e) throw Error("The Electron development server URL is missing.");
		f = g(e), await b(f);
		return;
	}
	let t = await y();
	f = t.url, p = t.launchSecret, await b(f, p);
}
function S(e) {
	let t = e instanceof Error ? e.message : "Unknown startup error.";
	s.showErrorBox("BaSyx Studio could not start", t), o.quit();
}
o.whenReady().then(x).catch(S), o.on("activate", () => {
	a.getAllWindows().length === 0 && f && b(f, p).catch(S);
}), o.on("before-quit", () => {
	h = !0, m?.kill(), m = void 0;
}), o.on("window-all-closed", () => {
	process.platform !== "darwin" && o.quit();
});
//#endregion
export {};
