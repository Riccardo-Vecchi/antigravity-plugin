"use strict";
const dictionaries = {
  en: [
    "Connected to Antigravity",
    "Not connected",
    "Profile name",
    "Save",
    "Reconnect",
    "Share this tab",
    "Only shared tabs on the approved site are accessible. Changing site ends sharing. Password fields and private browsing are excluded.",
    "Stop sharing all tabs",
    "Tab {id}",
    "Stop",
  ],
  it: [
    "Connesso ad Antigravity",
    "Non connesso",
    "Nome del profilo",
    "Salva",
    "Riconnetti",
    "Condividi questa scheda",
    "Sono accessibili solo le schede condivise sul sito approvato. Cambiare sito termina la condivisione. Password e navigazione privata sono escluse.",
    "Interrompi tutte le condivisioni",
    "Scheda {id}",
    "Interrompi",
  ],
  de: [
    "Mit Antigravity verbunden",
    "Nicht verbunden",
    "Profilname",
    "Speichern",
    "Neu verbinden",
    "Diesen Tab freigeben",
    "Nur freigegebene Tabs auf der genehmigten Website sind zugänglich. Ein Websitewechsel beendet die Freigabe. Passwortfelder und private Tabs sind ausgeschlossen.",
    "Alle Freigaben beenden",
    "Tab {id}",
    "Beenden",
  ],
  es: [
    "Conectado a Antigravity",
    "Sin conexión",
    "Nombre del perfil",
    "Guardar",
    "Reconectar",
    "Compartir esta pestaña",
    "Solo se accede a pestañas compartidas del sitio autorizado. Cambiar de sitio termina el acceso. Se excluyen contraseñas y navegación privada.",
    "Dejar de compartir todo",
    "Pestaña {id}",
    "Detener",
  ],
  fr: [
    "Connecté à Antigravity",
    "Non connecté",
    "Nom du profil",
    "Enregistrer",
    "Reconnecter",
    "Partager cet onglet",
    "Seuls les onglets partagés du site autorisé sont accessibles. Changer de site arrête le partage. Mots de passe et navigation privée sont exclus.",
    "Arrêter tous les partages",
    "Onglet {id}",
    "Arrêter",
  ],
  zh: [
    "已连接 Antigravity",
    "未连接",
    "配置名称",
    "保存",
    "重新连接",
    "共享此标签页",
    "只能访问已授权网站的共享标签页。切换网站将停止共享。不包括密码字段和隐私浏览。",
    "停止所有共享",
    "标签页 {id}",
    "停止",
  ],
  ja: [
    "Antigravity に接続済み",
    "未接続",
    "プロファイル名",
    "保存",
    "再接続",
    "このタブを共有",
    "許可したサイトの共有タブだけにアクセスします。別のサイトに移動すると共有が終了します。パスワード欄とプライベートブラウズは対象外です。",
    "すべての共有を停止",
    "タブ {id}",
    "停止",
  ],
};
for (const [language, label] of Object.entries({
  en: "Stop sharing this tab",
  it: "Non condividere più questa scheda",
  de: "Freigabe dieses Tabs beenden",
  es: "Dejar de compartir esta pestaña",
  fr: "Arrêter le partage de cet onglet",
  zh: "停止共享此标签页",
  ja: "このタブの共有を停止",
}))
  dictionaries[language].push(label);
const lang = (chrome.i18n.getUILanguage() || "en").split("-")[0],
  t = dictionaries[lang] || dictionaries.en,
  $ = (id) => document.getElementById(id);
for (const [id, index] of Object.entries({
  label: 2,
  save: 3,
  connect: 4,
  share: 5,
  explain: 6,
  stop: 7,
}))
  $(id).textContent = t[index];
const errors = {
  "Open Antigravity and enable Browser use in Settings.": {
    it: "Apri Antigravity e abilita Uso del browser nelle impostazioni.",
    de: "Öffne Antigravity und aktiviere Browsernutzung in den Einstellungen.",
    es: "Abre Antigravity y activa Uso del navegador en los ajustes.",
    fr: "Ouvrez Antigravity et activez Utilisation du navigateur dans les paramètres.",
    zh: "打开 Antigravity 并在设置中启用浏览器使用。",
    ja: "Antigravity の設定でブラウザー操作を有効にしてください。",
  },
  "Open a regular web page to share it.": {
    it: "Apri una normale pagina web per condividerla.",
    de: "Öffne eine normale Webseite zum Freigeben.",
    es: "Abre una página web normal para compartirla.",
    fr: "Ouvrez une page web normale pour la partager.",
    zh: "请打开普通网页后再共享。",
    ja: "通常のウェブページを開いてから共有してください。",
  },
  "Private browsing tabs are excluded.": {
    it: "Le schede di navigazione privata sono escluse.",
    de: "Private Tabs sind ausgeschlossen.",
    es: "Se excluyen las pestañas privadas.",
    fr: "Les onglets privés sont exclus.",
    zh: "隐私浏览标签页不在共享范围内。",
    ja: "プライベートブラウズのタブは共有できません。",
  },
  "Choose a profile name.": {
    it: "Scegli un nome per il profilo.",
    de: "Wähle einen Profilnamen.",
    es: "Elige un nombre para el perfil.",
    fr: "Choisissez un nom de profil.",
    zh: "请选择配置名称。",
    ja: "プロファイル名を入力してください。",
  },
  "Extension unavailable.": {
    it: "Estensione non disponibile.",
    de: "Erweiterung nicht verfügbar.",
    es: "Extensión no disponible.",
    fr: "Extension indisponible.",
    zh: "扩展程序不可用。",
    ja: "拡張機能を利用できません。",
  },
};
const message = (error) =>
  errors[error?.message]?.[lang] ||
  error?.message ||
  errors["Extension unavailable."]?.[lang] ||
  "Extension unavailable.";
async function request(action, extra = {}) {
  const result = await chrome.runtime.sendMessage({ action, ...extra });
  if (!result?.ok) throw Error(result?.error || "Extension unavailable.");
  return result.result;
}
let busy = false,
  latest = {},
  dirty = false,
  signature = "";
function controls() {
  for (const b of $("tabs").querySelectorAll("button"))
    b.disabled = busy || !latest.ready;
  $("share").textContent = t[latest.current?.shared ? 10 : 5];
  $("share").disabled = busy || !latest.ready || !latest.current;
  $("save").disabled = busy || !dirty || !$("name").value.trim();
  $("connect").disabled = busy;
  $("stop").disabled = busy || !latest.shared?.length;
}
function render(state) {
  latest = state;
  $("status").textContent = t[state.ready ? 0 : 1];
  $("connect").hidden = state.ready;
  if (!dirty) $("name").value = state.profile?.label || "";
  const next = JSON.stringify(state.shared);
  if (signature !== next) {
    signature = next;
    $("tabs").replaceChildren();
    for (const tab of state.shared || []) {
      const li = document.createElement("li"),
        label = document.createElement("span"),
        button = document.createElement("button");
      label.textContent = tab.title || t[8].replace("{id}", tab.id);
      label.title = label.textContent;
      button.textContent = t[9];
      button.onclick = () => act("revoke", { tab: tab.id });
      li.append(label, button);
      $("tabs").append(li);
    }
  }
  controls();
}
async function act(action, extra) {
  if (busy) return;
  busy = true;
  $("error").textContent = "";
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    await request(action, extra);
    if (action === "label") dirty = false;
    render(await request("status"));
  } catch (e) {
    $("error").textContent = message(e);
    try {
      render(await request("status"));
    } catch {}
  } finally {
    busy = false;
    controls();
  }
}
$("share").onclick = () =>
  latest.current?.shared
    ? act("revoke", { tab: latest.current.id })
    : act("share");
$("name").addEventListener("input", () => {
  dirty = $("name").value !== (latest.profile?.label || "");
  controls();
});
setInterval(() => {
  if (!busy)
    request("status")
      .then(render)
      .catch(() => {});
}, 1500);
$("connect").onclick = () => act("connect");
$("stop").onclick = () => act("revokeAll");
$("save").onclick = () => act("label", { label: $("name").value });
request("status")
  .then(render)
  .catch((e) => ($("error").textContent = message(e)));
