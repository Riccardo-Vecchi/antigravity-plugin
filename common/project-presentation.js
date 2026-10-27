/* Shared icon catalogue and read-only native project identity lookup. */
(() => {
 'use strict';
 if (globalThis.__AGProjectPresentation) return;
 const NS = 'http://www.w3.org/2000/svg';
  const paths = {
    folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
    terminal: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z', 'm7 8 4 4-4 4', 'M13 16h4'],
    code: ['m8 6-6 6 6 6', 'm16 6 6 6-6 6', 'm14 3-4 18'],
    monitor: ['M3 3h18v13H3Z', 'M8 21h8', 'M12 16v5'],
    server: ['M3 3h18v7H3Z', 'M3 14h18v7H3Z', 'M6 6h.01', 'M6 17h.01', 'M10 6h8', 'M10 17h8'],
    chip: ['M6 6h12v12H6Z', 'M9 9h6v6H9Z', 'M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4'],
    cloud: ['M7 18a5 5 0 1 1 1-10 7 7 0 0 1 13 4 4 4 0 0 1-1 8H7'],
    robot: ['M5 7h14v13H5Z', 'M12 3v4', 'M9 11h.01m6 0h.01', 'M9 16h6', 'M2 11v5m20-5v5'],
    settings: ['m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    wrench: ['M14 3a6 6 0 0 0-6 8L3 16a3 3 0 0 0 5 5l5-5a6 6 0 0 0 8-6l-4 3-4-4 3-4Z'],
    briefcase: ['M3 7h18v14H3Z', 'M8 7V3h8v4', 'M3 12c5 3 13 3 18 0', 'M10 13v3h4v-3'],
    book: ['M3 3h7l2 2 2-2h7v17h-7l-2 2-2-2H3Z', 'M12 5v17'],
    notebook: ['M6 3h14v18H6Z', 'M3 6h5m-5 6h5m-5 6h5', 'M11 7h5m-5 4h5'],
    graduation: ['m2 9 10-6 10 6-10 6Z', 'M6 12v6c4 3 8 3 12 0v-6', 'M22 9v9'],
    pencil: ['m4 16 12-12 4 4L8 20l-5 1Z', 'm13 7 4 4'],
    pen: ['m4 20 3-11 10-6 4 4-6 10-11 3Z', 'm4 20 8-8', 'M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
    music: ['M9 18V5l12-2v13', 'M9 5v5l12-2', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    film: ['M3 3h18v18H3Z', 'M7 3v18m10-18v18', 'M3 8h4m-4 8h4m10-8h4m-4 8h4'],
    atom: ['M22 12a10 4 0 1 1-20 0 10 4 0 0 1 20 0', 'M17 3c3 2 2 8-1 13s-7 7-9 5-2-8 1-13 7-7 9-5Z', 'M7 3c-3 2-2 8 1 13s7 7 9 5 2-8-1-13S9 1 7 3Z'],
    palette: ['M12 3a9 9 0 1 0 0 18c4 0 0-4 3-5h3c5-2 2-13-6-13Z', 'M7 8h.01m5-2h.01m5 3h.01M6 13h.01'],
    stethoscope: ['M3 3v5a5 5 0 0 0 10 0V3', 'M2 3h3m7 0h3', 'M8 13v3a5 5 0 0 0 10 0v-2', 'M21 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    puzzle: ['M3 3h6a3 3 0 1 0 6 0h6v6a3 3 0 1 1 0 6v6h-6a3 3 0 1 0-6 0H3v-6a3 3 0 1 0 0-6Z'],
    leaf: ['M20 3C8 2 2 9 5 16c7 7 17-1 15-13Z', 'M4 21 15 10'],
    shopping: ['M4 7h16l1 14H3Z', 'M8 7V5a4 4 0 0 1 8 0v2'],
    chart: ['M4 21V10h4v11m2 0V3h4v18m2 0V7h4v14', 'M2 21h20'],
    money: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9', 'M12 6v12'],
    dumbbell: ['m6 6-3 3 12 12 3-3Z', 'm8 4 12 12', 'm4 8 12 12', 'm12 9-3 3'],
    scales: ['M12 3v18', 'M6 21h12', 'M3 7h18', 'm6 7-4 8h8Zm12 0-4 8h8Z'],
    globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18'],
    plane: ['m22 2-7 20-4-9-9-4Z', 'm11 13 5-5'],
    heart: ['M20 5c-3-3-7-1-8 1-1-2-5-4-8-1s-2 6 0 8l8 8 8-8c2-2 3-5 0-8Z'],
    paw: ['M8 13c-1 2-4 3-3 6s4 1 7 1 6 2 7-1-2-4-3-6-6-2-8 0Z', 'M5 9a2 3 0 1 1-4 0 2 3 0 0 1 4 0', 'M11 5a2 3 0 1 1-4 0 2 3 0 0 1 4 0', 'M17 5a2 3 0 1 1-4 0 2 3 0 0 1 4 0', 'M23 9a2 3 0 1 1-4 0 2 3 0 0 1 4 0'],
    flask: ['M9 3h6', 'M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3', 'M7 15h10'],
    brain: ['M12 5c-3-5-8-1-7 3-5 2-3 8 0 8-1 5 5 7 7 3 2 4 8 2 7-3 3 0 5-6 0-8 1-4-4-8-7-3Z', 'M12 5v14', 'M5 8l3 2m11-2-3 2M5 16l3-2m11 2-3-2'],
    flower: ['M12 9c-6-12-11-1-3 3-12 6-1 11 3 3 6 12 11 1 3-3 12-6 1-11-3-3Z', 'M12 15v7'],
    home: ['m3 10 9-8 9 8v11h-7v-7h-4v7H3Z'],
    camera: ['M3 7h5l2-3h4l2 3h5v14H3Z', 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
    phone: ['M6 2h12v20H6Z', 'M10 18h4'],
    shield: ['m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6Z', 'm8 12 3 3 5-6'],
    rocket: ['M8 16c0-7 5-12 13-13 0 8-5 13-12 13Z', 'm9 9-6 1-1 5 6-1m6 1-1 6 5-1 1-6', 'm3 21 3-3', 'M17 7h.01'],
    gamepad: ['M7 7h10q4 0 5 8 1 7-5 3H7q-6 4-5-3 1-8 5-8Z', 'M7 10v6m-3-3h6m6-2h.01m3 4h.01'],
    coffee: ['M3 3h14v12q0 4-7 4t-7-4Z', 'M17 4h3q3 5-3 8', 'M2 22h17'],
    bicycle: ['M10 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M22 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'm6 17 5-9 7 9-4-13h3', 'M8 8h6'],
    lightbulb: ['M8 17c0-3-4-4-4-8a8 8 0 0 1 16 0c0 4-4 5-4 8Z', 'M8 20h8m-7 3h6'],
    flag: ['M4 22V3c6-5 10 5 16 0v11c-6 5-10-5-16 0'],
    tree: ['m12 2-7 9h3l-5 7h7v4h4v-4h7l-5-7h3Z'],
    mail: ['M3 4h18v16H3Z', 'm3 4 9 9 9-9'],
    star: ['m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z']
  };
  function svg(name, size = 18) {
    const node = document.createElementNS(NS, 'svg');
    for (const [key, value] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) node.setAttribute(key, value);
    for (const d of paths[name] || paths.folder) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); node.append(p); }
    return node;
  }
  function projectFrom(element) {
    let node = element;
    for (let i=0; node && i<8; i++,node=node.parentElement) {
      const header = node.matches?.('[data-testid="project-header"]') ? node : node.querySelector?.('[data-testid="project-header"]');
      const link = node.querySelector?.('a[href*="section="]');
      if (!header || !link || node.querySelectorAll('[data-testid="project-header"]').length > 1) continue;
      const id = new URL(link.getAttribute('href'),location.origin).searchParams.get('section');
      if (!id || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) continue;
      return {id,name:header.getAttribute('data-project-label')||header.textContent,header,link,trigger:node.querySelector('button[aria-haspopup="menu"]')};
    }
    return null;
  }

 function byName(name) {
  const matches = new Map();
  for (const header of document.querySelectorAll('[data-testid="project-header"]')) {
   const project = projectFrom(header);
   if (project && project.name === name) matches.set(project.id, project);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
 }
 globalThis.__AGProjectPresentation = {version:'1.0.0',paths,svg,projectFrom,byName,destroy(){delete globalThis.__AGProjectPresentation;}};
})();
