"use strict";
// Select-only combobox. Native <option> elements cannot reliably show images.
// The automatic popover handles outside clicks and Escape without document listeners.
function createBrowserPicker({items, value, icons, label, onChange}) {
  const root = document.createElement("div");
  root.className = "agpa-browser-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "agpa-comp-button agpa-browser-trigger";
  trigger.setAttribute("data-agpa-browser-trigger", "");
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "agpa-browser-popup";
  list.id = "agpa-browser-" + crypto.randomUUID();
  list.setAttribute("popover", "auto");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  trigger.setAttribute("aria-controls", list.id);
  let selected = Math.max(0, items.findIndex(item => item.id === value));
  let active = selected, search = "", lastKey = 0;
  const rows = [];
  function icon(id) {
    const image = document.createElement(icons[id] ? "img" : "span");
    image.className = "agpa-browser-icon";
    image.setAttribute("aria-hidden", "true");
    if (icons[id]) {image.src = icons[id];image.alt = "";image.width = image.height = 20;}
    else image.textContent = "◎";
    return image;
  }
  function highlight(index) {
    active = index;
    rows.forEach((row, i) => row.toggleAttribute("data-active", i === active));
    trigger.setAttribute("aria-activedescendant", rows[active].id);
    rows[active].scrollIntoView({block: "nearest"});
  }
  function close() {
    if (list.matches(":popover-open")) list.hidePopover();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }
  function open() {
    if (trigger.disabled || list.matches(":popover-open")) return;
    const r = trigger.getBoundingClientRect(), width = Math.min(Math.max(220, r.width), window.innerWidth - 24);
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const down = below >= Math.min(items.length * 38 + 12, 280) || below >= above;
    const height = Math.max(40, down ? below : above);
    Object.assign(list.style, {width: width + "px", left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) + "px",
      top: down ? r.bottom + 5 + "px" : "auto", bottom: down ? "auto" : window.innerHeight - r.top + 5 + "px", maxHeight: height + "px"});
    list.showPopover();
    trigger.setAttribute("aria-expanded", "true");
    highlight(selected);
  }
  function choose(index) {
    if (trigger.disabled) return;
    root.setValue(items[index].id);
    close();
    trigger.focus();
    onChange(items[index].id);
  }
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.id = list.id + "-" + index;
    row.className = "agpa-browser-option";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === selected));
    row.dataset.browser = item.id;
    const name = document.createElement("span");name.textContent = item.label;
    const check = document.createElement("span");check.className = "agpa-browser-check";check.setAttribute("aria-hidden", "true");check.textContent = index === selected ? "✓" : "";
    row.append(icon(item.id), name, check);
    row.addEventListener("click", () => choose(index));
    list.append(row);rows.push(row);
  });
  const name = document.createElement("span");name.textContent = items[selected].label;
  const arrow = document.createElement("span");arrow.textContent = "⌄";arrow.className = "agpa-browser-arrow";arrow.setAttribute("aria-hidden", "true");
  trigger.append(icon(items[selected].id), name, arrow);
  root.setValue = value => {
    if(root.value===value)return;
    const index=items.findIndex(item=>item.id===value);if(index<0)return;
    selected=index;name.textContent=items[index].label;trigger.replaceChildren(icon(items[index].id),name,arrow);root.value=items[index].id;
    rows.forEach((row,i)=>{row.setAttribute('aria-selected',String(i===selected));row.children[2].textContent=i===selected?'✓':'';});
  };
  root.value=items[selected].id;
  root.close=close;
  trigger.addEventListener("click", () => list.matches(":popover-open") ? close() : open());
  list.addEventListener("toggle", event => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "closed") trigger.removeAttribute("aria-activedescendant");
  });
  trigger.addEventListener("keydown", event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const wasOpen = list.matches(":popover-open");
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();open();
      highlight(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : wasOpen ? (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : selected);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();wasOpen ? choose(active) : open();
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape" && wasOpen) {event.preventDefault();event.stopPropagation();}
      close();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      event.preventDefault();open();
      const now = Date.now();search = (now - lastKey > 600 ? "" : search) + event.key.toLowerCase();lastKey = now;
      const index = items.findIndex(item => item.label.toLowerCase().startsWith(search));
      if (index >= 0) highlight(index);
    }
  });
  root.append(trigger, list);
  return root;
}
module.exports = {createBrowserPicker};
