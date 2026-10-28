// Runs only inside the opaque, network-blocked preview iframe.
import { renderAsync } from "docx-preview";
import { unzipSync, strFromU8 } from "fflate";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
} from "pdfjs-dist/build/pdf.mjs";
import pdfStyles from "pdfjs-dist/web/pdf_viewer.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

const root = document.getElementById("preview"),
  urls = [];
const node = (tag, value) => {
  const n = document.createElement(tag);
  if (value !== undefined) n.textContent = String(value);
  return n;
};
const tags = (n, name) => [...n.getElementsByTagNameNS("*", name)];
const attr = (n, name) => n?.getAttribute(name) || "";
function xml(bytes) {
  const d = new DOMParser().parseFromString(
    strFromU8(bytes),
    "application/xml",
  );
  if (d.getElementsByTagName("parsererror").length) throw Error("invalid");
  return d;
}
function blob(bytes, mime) {
  const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
  urls.push(u);
  return u;
}
function archive(bytes) {
  // Bound declared expansion before a renderer allocates or decodes archive parts.
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (d.getUint32(p, true) === 0x06054b50) {
      end = p;
      break;
    }
  if (end < 0) throw Error("invalid");
  const count = d.getUint16(end + 10, true);
  let p = d.getUint32(end + 16, true),
    total = 0;
  if (count > 5000) throw Error("tooLarge");
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || d.getUint32(p, true) !== 0x02014b50)
      throw Error("invalid");
    const size = d.getUint32(p + 24, true);
    total += size;
    if (size > 40 * 1024 * 1024 || total > 100 * 1024 * 1024)
      throw Error("tooLarge");
    p +=
      46 +
      d.getUint16(p + 28, true) +
      d.getUint16(p + 30, true) +
      d.getUint16(p + 32, true);
  }
  return () =>
    unzipSync(bytes, {
      filter: (f) => /\.(?:xml|rels|png|jpg|jpeg|gif|webp)$/i.test(f.name),
    });
}
function note(text) {
  const n = node("p", text);
  n.className = "note";
  root.append(n);
}
function workbook(bytes, labels) {
  const z = archive(bytes)(),
    book = xml(z["xl/workbook.xml"]),
    rels = xml(z["xl/_rels/workbook.xml.rels"]);
  const map = new Map(
    tags(rels, "Relationship").map((r) => [attr(r, "Id"), attr(r, "Target")]),
  );
  const strings = z["xl/sharedStrings.xml"]
    ? tags(xml(z["xl/sharedStrings.xml"]), "si").map((n) =>
        tags(n, "t")
          .map((t) => t.textContent)
          .join(""),
      )
    : [];
  const controls = node("div");
  controls.className = "tabs";
  const body = node("div");
  body.className = "sheet-wrap";
  root.append(controls, body);
  note(labels.spreadsheet);
  for (const sheet of tags(book, "sheet")) {
    const button = node("button", attr(sheet, "name"));
    controls.append(button);
    button.onclick = () => {
      for (const b of controls.children)
        b.setAttribute("aria-pressed", String(b === button));
      body.replaceChildren();
      let target =
        map.get(
          sheet.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id",
          ) || attr(sheet, "r:id"),
        ) || "";
      target = target.startsWith("/")
        ? target.slice(1)
        : "xl/" + target.replace(/^\.\//, "");
      if (!z[target]) throw Error("invalid");
      const rows = tags(xml(z[target]), "row"),
        table = node("table");
      body.append(table);
      let shown = 0;
      for (const row of rows) {
        if (++shown > 1000) break;
        const tr = node("tr");
        tr.append(node("th", attr(row, "r")));
        table.append(tr);
        let col = 0;
        for (const cell of tags(row, "c")) {
          const letters = /^[A-Z]+/.exec(attr(cell, "r"))?.[0] || "A";
          let index = 0;
          for (const c of letters) index = index * 26 + c.charCodeAt(0) - 64;
          index = Math.min(index, 101);
          while (col < index - 1 && col < 100) {
            tr.append(node("td", ""));
            col++;
          }
          if (col >= 100) break;
          const v = tags(cell, "v")[0]?.textContent ?? "",
            type = attr(cell, "t");
          const value =
            type === "s"
              ? strings[Number(v)] || ""
              : type === "inlineStr"
                ? tags(cell, "t")
                    .map((t) => t.textContent)
                    .join("")
                : type === "b"
                  ? v === "1"
                    ? "TRUE"
                    : "FALSE"
                  : v;
          tr.append(node("td", value));
          col++;
        }
      }
      if (rows.length > 1000) body.append(node("p", labels.limited));
    };
  }
  controls.firstElementChild?.click();
}
function slides(bytes, labels) {
  const z = archive(bytes)();
  const files = Object.keys(z)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
    );
  note(labels.slides);
  for (const [i, file] of files.entries()) {
    const slide = node("section");
    slide.className = "slide";
    slide.append(node("h2", `${labels.slide} ${i + 1}`));
    for (const paragraph of tags(xml(z[file]), "p")) {
      const content = tags(paragraph, "t")
        .map((t) => t.textContent)
        .join("");
      if (content.trim()) slide.append(node("p", content));
    }
    const relationships = z[file.replace("slides/", "slides/_rels/") + ".rels"];
    if (relationships) {
      const rels = tags(xml(relationships), "Relationship");
      for (const r of rels) {
        if (
          attr(r, "TargetMode") === "External" ||
          !attr(r, "Type").endsWith("/image")
        )
          continue;
        const target = attr(r, "Target").replace(/^\.\.\//, "ppt/");
        if (!z[target] || z[target].length > 5 * 1024 * 1024) continue;
        const img = node("img");
        img.alt = "";
        img.src = blob(
          z[target],
          "image/" + (target.endsWith(".png") ? "png" : "jpeg"),
        );
        slide.append(img);
      }
    }
    root.append(slide);
  }
}
function csv(text, delimiter) {
  const table = node("table");
  let row = [],
    cell = "",
    quoted = false,
    rows = 0;
  const append = () => {
    row.push(cell);
    cell = "";
  };
  const finish = () => {
    append();
    const tr = node("tr");
    for (const value of row.slice(0, 100)) tr.append(node("td", value));
    table.append(tr);
    row = [];
    rows++;
  };
  for (let i = 0; i < text.length && rows < 1000; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) append();
    else if (c === "\n" && !quoted) finish();
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) finish();
  const wrap = node("div");
  wrap.className = "sheet-wrap";
  wrap.append(table);
  root.append(wrap);
}
async function model(bytes, extension) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(?:data:|blob:)/.test(url)) return url;
    throw Error("externalModel");
  });
  let object;
  if (extension === "glb" || extension === "gltf")
    object = (
      await new GLTFLoader(manager).parseAsync(
        extension === "glb" ? bytes.buffer : new TextDecoder().decode(bytes),
        "",
      )
    ).scene;
  else if (extension === "obj") {
    object = new OBJLoader(manager).parse(new TextDecoder().decode(bytes));
    object.traverse((n) => {
      if (n.isMesh) {
        n.material?.dispose();
        n.material = new THREE.MeshStandardMaterial({
          color: 0x79aaf0,
          roughness: 0.65,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
      }
    });
  } else {
    const geometry =
      extension === "stl"
        ? new STLLoader(manager).parse(bytes.buffer)
        : new PLYLoader(manager).parse(bytes.buffer);
    geometry.computeVertexNormals();
    object = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x79aaf0,
        roughness: 0.55,
        metalness: 0.12,
        side: THREE.DoubleSide,
      }),
    );
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#17191d");
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4e566a, 3));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 5, 4);
  scene.add(light);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw Error("invalid");
  const center = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3()).length();
  object.position.sub(center);
  scene.add(object);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(40, 1, size / 1000, size * 100);
  camera.position.set(size * 0.8, size * 0.6, size * 1.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = size * 0.05;
  controls.maxDistance = size * 20;
  controls.update();
  root.className = "model";
  root.append(renderer.domElement);
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener("change", draw);
  const resize = () => {
    const w = root.clientWidth,
      h = root.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  resize();
  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      controls.dispose();
      object.traverse((n) => {
        n.geometry?.dispose();
        for (const m of Array.isArray(n.material)
          ? n.material
          : n.material
            ? [n.material]
            : [])
          m.dispose();
      });
      renderer.dispose();
    },
    { once: true },
  );
}
async function pdf(bytes, labels) {
  GlobalWorkerOptions.workerSrc = blob(
    new TextEncoder().encode(AGPA_PDF_WORKER),
    "text/javascript",
  );
  const style = node("style", pdfStyles);
  document.head.append(style);
  const task = getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    useWasm: false,
  });
  const doc = await task.promise;
  const bar = node("div"),
    previous = node("button", labels.previous),
    next = node("button", labels.next),
    counter = node("span"),
    surface = node("div");
  bar.className = "tabs";
  bar.style.alignItems = "center";
  surface.style.cssText =
    "position:relative;margin:auto;background:white;max-width:100%;overflow:hidden";
  bar.append(previous, counter, next);
  root.append(bar, surface);
  let number = 1,
    busy = false;
  async function paint() {
    if (busy) return;
    busy = true;
    previous.disabled = true;
    next.disabled = true;
    const page = await doc.getPage(number),
      base = page.getViewport({ scale: 1 }),
      scale = Math.min(
        1.5,
        Math.max(0.2, (root.clientWidth - 44) / base.width),
      ),
      viewport = page.getViewport({ scale }),
      ratio = Math.min(devicePixelRatio, 2),
      canvas = node("canvas"),
      layer = node("div");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px`;
    surface.style.width = viewport.width + "px";
    surface.style.height = viewport.height + "px";
    surface.style.setProperty("--total-scale-factor", scale);
    surface.style.setProperty("--scale-factor", scale);
    layer.className = "textLayer";
    surface.replaceChildren(canvas, layer);
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    await new TextLayer({
      textContentSource: await page.getTextContent(),
      container: layer,
      viewport,
    }).render();
    counter.textContent = `${number} / ${doc.numPages}`;
    previous.disabled = number === 1;
    next.disabled = number === doc.numPages;
    busy = false;
  }
  previous.onclick = () => {
    if (!busy && number > 1) {
      number--;
      paint();
    }
  };
  next.onclick = () => {
    if (!busy && number < doc.numPages) {
      number++;
      paint();
    }
  };
  window.addEventListener("pagehide", () => task.destroy(), { once: true });
  await paint();
}
async function render(payload, labels) {
  const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
  const ext = payload.extension;
  if (payload.category === "models") return model(bytes, ext);
  if (ext === "docx") {
    archive(bytes);
    await renderAsync(bytes, root, undefined, {
      renderAltChunks: false,
      experimental: false,
      ignoreLastRenderedPageBreak: false,
      useBase64URL: true,
    });
    return;
  }
  if (ext === "xlsx") return workbook(bytes, labels);
  if (ext === "pptx") return slides(bytes, labels);
  if (ext === "md") {
    root.className = "markdown";
    root.innerHTML = DOMPurify.sanitize(
      marked.parse(new TextDecoder().decode(bytes)),
      {
        FORBID_TAGS: ["style", "iframe", "object", "form", "input"],
        FORBID_ATTR: ["style"],
      },
    );
    return;
  }
  if (ext === "csv" || ext === "tsv")
    return csv(new TextDecoder().decode(bytes), ext === "tsv" ? "\t" : ",");
  if (payload.category === "images") {
    const image = node("img");
    image.className = "image";
    image.alt = payload.name;
    image.src = blob(
      bytes,
      ext === "svg"
        ? "image/svg+xml"
        : "image/" + (ext === "jpg" ? "jpeg" : ext),
    );
    root.append(image);
    return;
  }
  if (payload.category === "media") {
    const audio = ["mp3", "wav", "ogg", "m4a"].includes(ext);
    const media = node(audio ? "audio" : "video");
    media.controls = true;
    media.src = blob(bytes, (audio ? "audio/" : "video/") + ext);
    root.append(media);
    return;
  }
  if (ext === "pdf") {
    return pdf(bytes, labels);
  }
  if (["odt", "ods", "odp", "rtf"].includes(ext)) throw Error("unsupported");
  const pre = node("pre", new TextDecoder().decode(bytes));
  root.append(pre);
}
const receive = async (event) => {
  if (
    event.source !== parent ||
    event.data?.kind !== "agpa-preview" ||
    !event.ports[0]
  )
    return;
  window.removeEventListener("message", receive, true);
  const port = event.ports[0];
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection()?.toString() || "";
    port.postMessage({ selection: selection.slice(0, 12000) });
  });
  window.addEventListener("pagehide", () => port.close(), { once: true });
  try {
    await render(event.data.payload, event.data.labels);
    port.postMessage({ ok: true });
  } catch (e) {
    root.replaceChildren(
      node("p", event.data.labels[e.message] || event.data.labels.failed),
    );
    port.postMessage({ ok: false });
  }
};
window.addEventListener("message", receive, true);
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest("a")) e.preventDefault();
  },
  true,
);
window.addEventListener(
  "pagehide",
  () => {
    for (const url of urls) URL.revokeObjectURL(url);
  },
  { once: true },
);
