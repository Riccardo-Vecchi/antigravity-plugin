"use strict";
// The file viewer also has a sidebar-toggle. Only the control beside the app logo
// owns the main navigation layout.
function primaryLayout(document) {
  const brand = document.querySelector(
    "[data-testid=app-icon-new-conversation-button]",
  );
  const toggle = brand?.parentElement?.querySelector(
    "[data-testid=sidebar-toggle]",
  );
  const navigation = document
    .querySelector("[data-testid=settings-button]")
    ?.closest("[role=navigation]");
  const panel = navigation?.parentElement?.parentElement;
  return { brand, toggle, navigation, panel };
}
function createHoverIntent({
  open,
  close,
  canClose = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  openDelay = 110,
  closeDelay = 220,
}) {
  let opening = null,
    closing = null,
    visible = false,
    stopped = false;
  function cancelOpening() {
    if (opening !== null) clearTimer(opening);
    opening = null;
  }
  function cancelClosing() {
    if (closing !== null) clearTimer(closing);
    closing = null;
  }
  return {
    enter() {
      if (stopped) return;
      cancelClosing();
      if (visible || opening !== null) return;
      opening = setTimer(() => {
        opening = null;
        if (stopped) return;
        visible = open() !== false;
      }, openDelay);
    },
    leave() {
      if (stopped) return;
      cancelOpening();
      if (!visible || closing !== null) return;
      closing = setTimer(() => {
        closing = null;
        if (!canClose()) return;
        visible = false;
        close();
      }, closeDelay);
    },
    hide() {
      cancelOpening();
      cancelClosing();
      visible = false;
      close();
    },
    destroy() {
      stopped = true;
      this.hide();
    },
  };
}
// Give coupled CSS transitions one clock. Electron can defer the first render
// commit of an occluded window, leaving transitions pending at time zero.
function startSidebarMotion(elements, timeline) {
  if (!Number.isFinite(timeline?.currentTime)) return;
  for (const element of elements)
    for (const animation of element?.getAnimations() || []) {
      if (
        animation.pending &&
        animation.startTime === null &&
        animation.playState === "running" &&
        [
          "width",
          "transform",
          "opacity",
          "visibility",
          "--agpa-navigation-width",
          "--agpa-rail-width",
        ].includes(animation.transitionProperty)
      )
        animation.startTime = timeline.currentTime;
    }
}
module.exports = { primaryLayout, createHoverIntent, startSidebarMotion };
