(() => {
  const STORAGE_KEY = "stone-plate-state-v1";
  const GRID = 64;
  const TILE_STYLES = {
    stone: { fill: "#67675d", stroke: "#8a897c" },
    water: { fill: "#477e83", stroke: "#86b8b6" },
    grass: { fill: "#754455", stroke: "#b76e8b" },
    lava: { fill: "#a84e3c", stroke: "#e99561" },
    wall: { fill: "#9d9a8c", stroke: "#d0cdbd" },
    void: { fill: "#171b20", stroke: "#8290a2" }
  };
  const canvas = document.getElementById("playerMapCanvas");
  const context = canvas.getContext("2d");
  const panel = document.getElementById("playerMapPanel");
  let mapState = loadMapState();
  let zoom = 1;
  let hideTokenNames = false;
  let panX = 0;
  let panY = 0;
  let panPointer = null;
  const tokenImageCache = new Map();
  const tileImageCache = new Map();

  function loadMapState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.tokens) && Array.isArray(saved.tiles) && Array.isArray(saved.shapes)) return saved;
    } catch (error) {
      console.warn("Não foi possível carregar o mapa para a projeção.", error);
    }
    return { tokens: [], tiles: [], shapes: [], map: { shape: "square", width: 50, height: 50 }, initiative: { activeTokenId: null } };
  }

  function normalizedMap() {
    const source = mapState.map || {};
    const shape = ["rectangle", "square", "circle", "triangle"].includes(source.shape) ? source.shape : "square";
    const width = Math.max(1, Math.min(10000, Math.floor(Number(source.width) || 50)));
    const height = shape === "square" || shape === "circle" ? width : Math.max(1, Math.min(10000, Math.floor(Number(source.height) || 50)));
    return { shape, width, height };
  }

  function mapBounds(map) {
    const left = -Math.floor(map.width / 2) * GRID;
    const top = -Math.floor(map.height / 2) * GRID;
    return { left, top, right: left + map.width * GRID, bottom: top + map.height * GRID, width: map.width * GRID, height: map.height * GRID };
  }

  function mapCellRange(map, row) {
    const y = (row + 0.5) / map.height;
    const halfWidth = map.shape === "circle" ? Math.sqrt(Math.max(0, 1 - (2 * y - 1) ** 2)) / 2 : y / 2;
    let start = Math.max(0, Math.ceil((0.5 - halfWidth) * map.width - 0.5) - 1);
    let end = Math.min(map.width, Math.floor((0.5 + halfWidth) * map.width - 0.5) + 2);
    const inside = column => {
      const x = (column + 0.5) / map.width;
      return map.shape === "circle" ? ((x - 0.5) / 0.5) ** 2 + ((y - 0.5) / 0.5) ** 2 <= 1 : Math.abs(x - 0.5) <= y / 2;
    };
    while (start < end && !inside(start)) start++;
    while (end > start && !inside(end - 1)) end--;
    return { start, end };
  }

  function boardPath(map, bounds) {
    const path = new Path2D();
    if (map.shape === "square" || map.shape === "rectangle") {
      path.rect(bounds.left, bounds.top, bounds.width, bounds.height);
      return path;
    }
    for (let row = 0; row < map.height; row++) {
      const range = mapCellRange(map, row);
      if (range.start < range.end) path.rect(bounds.left + range.start * GRID, bounds.top + row * GRID, (range.end - range.start) * GRID, GRID);
    }
    return path;
  }

  function boardOutlinePath(map, bounds) {
    const path = new Path2D();
    if (map.shape === "square" || map.shape === "rectangle") {
      path.rect(bounds.left, bounds.top, bounds.width, bounds.height);
      return path;
    }
    const empty = { start: 0, end: 0 };
    const addExposedEdges = (range, neighbor, y) => {
      if (range.start >= range.end) return;
      if (neighbor.start >= neighbor.end) {
        path.moveTo(bounds.left + range.start * GRID, y);
        path.lineTo(bounds.left + range.end * GRID, y);
        return;
      }
      if (range.start < neighbor.start) {
        path.moveTo(bounds.left + range.start * GRID, y);
        path.lineTo(bounds.left + Math.min(range.end, neighbor.start) * GRID, y);
      }
      if (range.end > neighbor.end) {
        path.moveTo(bounds.left + Math.max(range.start, neighbor.end) * GRID, y);
        path.lineTo(bounds.left + range.end * GRID, y);
      }
    };
    for (let row = 0; row < map.height; row++) {
      const range = mapCellRange(map, row);
      if (range.start >= range.end) continue;
      const top = bounds.top + row * GRID;
      const bottom = top + GRID;
      const previous = row > 0 ? mapCellRange(map, row - 1) : empty;
      const next = row + 1 < map.height ? mapCellRange(map, row + 1) : empty;
      addExposedEdges(range, previous, top);
      addExposedEdges(range, next, bottom);
      path.moveTo(bounds.left + range.start * GRID, top);
      path.lineTo(bounds.left + range.start * GRID, bottom);
      path.moveTo(bounds.left + range.end * GRID, top);
      path.lineTo(bounds.left + range.end * GRID, bottom);
    }
    return path;
  }

  function opacityOf(item) {
    const value = Number(item.opacity ?? mapState.opacity ?? 0.65);
    return Number.isFinite(value) ? Math.max(0.2, Math.min(1, value)) : 0.65;
  }

  function drawGrid(map, bounds, scale) {
    const stride = Math.max(1, Math.ceil(4 / (GRID * scale)), Math.ceil(map.width / 120), Math.ceil(map.height / 120));
    context.save();
    context.beginPath();
    context.lineWidth = 1 / scale;
    context.strokeStyle = "#85918435";
    for (let column = 0; column <= map.width; column += stride) {
      const x = bounds.left + column * GRID;
      context.moveTo(x, bounds.top);
      context.lineTo(x, bounds.bottom);
    }
    for (let row = 0; row <= map.height; row += stride) {
      const y = bounds.top + row * GRID;
      context.moveTo(bounds.left, y);
      context.lineTo(bounds.right, y);
    }
    context.stroke();
    context.restore();
  }

  function drawTiles(tiles) {
    for (const tile of tiles) {
      const style = TILE_STYLES[tile.kind];
      const image = tile.kind === "image" ? tileForDecoration(tile) : null;
      if (!style && tile.kind !== "image") continue;
      context.save();
      context.globalAlpha = opacityOf(tile);
      if (tile.kind === "image") {
        context.fillStyle = "#252b27";
        context.fillRect(tile.x - GRID / 2, tile.y - GRID / 2, GRID, GRID);
        if (image) {
          const scale = Math.min(GRID / image.naturalWidth, GRID / image.naturalHeight);
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(image, tile.x - width / 2, tile.y - height / 2, width, height);
        }
      } else {
        context.fillStyle = style.fill;
        context.fillRect(tile.x - GRID / 2, tile.y - GRID / 2, GRID, GRID);
        if (tile.kind === "void") {
          const hole = context.createRadialGradient(tile.x - GRID * 0.08, tile.y - GRID * 0.08, GRID * 0.04, tile.x, tile.y, GRID * 0.42);
          hole.addColorStop(0, "#020304");
          hole.addColorStop(0.72, "#080b10");
          hole.addColorStop(1, "#394451");
          context.fillStyle = hole;
          context.beginPath();
          context.ellipse(tile.x, tile.y, GRID * 0.38, GRID * 0.34, -0.12, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.strokeStyle = `${style?.stroke || "#aab5a4"}88`;
      context.lineWidth = 1.5;
      context.strokeRect(tile.x - GRID / 2, tile.y - GRID / 2, GRID, GRID);
      context.restore();
    }
  }

  function tileForDecoration(tile) {
    const source = tile.imageDataUrl ||
      mapState.decorations?.find(item => String(item.id) === String(tile.decorationId))?.imageDataUrl;
    if (!source) return null;
    let image = tileImageCache.get(source);
    if (!image) {
      image = new Image();
      image.addEventListener("load", renderMap, { once: true });
      image.addEventListener("error", () => tileImageCache.delete(source), { once: true });
      image.src = source;
      tileImageCache.set(source, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  function gridRoute(start, end) {
    let x = Math.round((start.x - GRID / 2) / GRID);
    let y = Math.round((start.y - GRID / 2) / GRID);
    const endX = Math.round((end.x - GRID / 2) / GRID);
    const endY = Math.round((end.y - GRID / 2) / GRID);
    const deltaX = Math.abs(endX - x);
    const stepX = x < endX ? 1 : -1;
    const deltaY = -Math.abs(endY - y);
    const stepY = y < endY ? 1 : -1;
    let error = deltaX + deltaY;
    const cells = [];
    while (cells.length < 20000) {
      cells.push({ x: x * GRID + GRID / 2, y: y * GRID + GRID / 2 });
      if (x === endX && y === endY) break;
      const doubledError = 2 * error;
      if (doubledError >= deltaY) { error += deltaY; x += stepX; }
      if (doubledError <= deltaX) { error += deltaX; y += stepY; }
    }
    return cells;
  }

  function drawShape(shape) {
    const isConstruction = shape.mode === "construction";
    const isAlert = shape.mode === "alert";
    context.save();
    context.globalAlpha = 1;
    context.fillStyle = isAlert ? "#e06d52" : shape.color || "#f4c95d";
    context.strokeStyle = isAlert ? "#ef755b" : shape.color || "#f4c95d";
    if (shape.kind === "stroke") {
      for (const point of shape.points || []) context.fillRect(point.x - GRID / 2, point.y - GRID / 2, GRID, GRID);
    } else if (shape.kind === "line") {
      for (const cell of gridRoute({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 })) {
        context.fillRect(cell.x - GRID / 2, cell.y - GRID / 2, GRID, GRID);
      }
    } else if (shape.filled === false && (shape.kind === "circle" || shape.kind === "square")) {
      const bounds = shapeBoundsForGrid(shape);
      const rows = Math.max(1, Math.round(bounds.height / GRID));
      const columns = Math.max(1, Math.round(bounds.width / GRID));
      for (let row = 0; row < rows; row++) {
        const range = shapeCellRange(shape, row, bounds);
        for (let column = range.start; column < range.end; column++) {
          const cell = { x: bounds.x + (column + 0.5) * GRID, y: bounds.y + (row + 0.5) * GRID };
          if (shapeOutlineCellContains(shape, cell, bounds)) context.fillRect(cell.x - GRID / 2, cell.y - GRID / 2, GRID, GRID);
        }
      }
    } else {
      const bounds = shapeBoundsForGrid(shape);
      const { x, y, width, height } = bounds;
      context.lineWidth = Number(shape.width) || 3;
      context.beginPath();
      if (shape.kind === "circle") context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      else context.rect(x, y, width, height);
      context.fill();
      context.stroke();
    }
    context.restore();
    if (isAlert) {
      const bounds = shapeBounds(shape);
      const label = shape.alertTriggered ? "DISPARADO" : `ALERTA · ${Math.max(0, shape.alertTurnsRemaining)}T · ${Math.max(0, shape.alertDamage)}D`;
      const scale = Math.min((canvas.clientWidth - 48) / Math.max(1, normalizedMap().width * GRID), (canvas.clientHeight - 48) / Math.max(1, normalizedMap().height * GRID));
      context.save();
      context.font = `700 ${Math.max(9, 10 / scale)}px "DM Mono", Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const labelWidth = context.measureText(label).width + 12 / scale;
      const labelX = bounds.x + bounds.width / 2;
      const labelY = bounds.y - 12 / scale;
      context.fillStyle = "#351d1bef";
      context.fillRect(labelX - labelWidth / 2, labelY - 9 / scale, labelWidth, 18 / scale);
      context.fillStyle = "#ffd8c8";
      context.fillText(label, labelX, labelY);
      context.restore();
    }
  }

  function shapeBoundsForGrid(shape) {
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    return { x, y, width: Math.max(GRID, Math.abs(shape.x2 - shape.x1)), height: Math.max(GRID, Math.abs(shape.y2 - shape.y1)) };
  }

  function shapeCellRange(shape, row, bounds = shapeBoundsForGrid(shape)) {
    const columns = Math.max(1, Math.round(bounds.width / GRID));
    const rows = Math.max(1, Math.round(bounds.height / GRID));
    if (row < 0 || row >= rows) return { start: 0, end: 0 };
    if (shape.kind !== "circle") return { start: 0, end: columns };
    const y = (row + 0.5) / rows;
    const halfWidth = Math.sqrt(Math.max(0, 1 - (2 * y - 1) ** 2)) / 2;
    let start = Math.max(0, Math.ceil((0.5 - halfWidth) * columns - 0.5) - 1);
    let end = Math.min(columns, Math.floor((0.5 + halfWidth) * columns - 0.5) + 2);
    const inside = column => {
      const x = (column + 0.5) / columns;
      return ((x - 0.5) / 0.5) ** 2 + ((y - 0.5) / 0.5) ** 2 <= 1;
    };
    while (start < end && !inside(start)) start++;
    while (end > start && !inside(end - 1)) end--;
    return { start, end };
  }

  function shapeOutlineCellContains(shape, point, bounds = shapeBoundsForGrid(shape)) {
    const column = Math.floor((point.x - bounds.x) / GRID);
    const row = Math.floor((point.y - bounds.y) / GRID);
    const columns = Math.max(1, Math.round(bounds.width / GRID));
    const rows = Math.max(1, Math.round(bounds.height / GRID));
    if (column < 0 || column >= columns || row < 0 || row >= rows) return false;
    if (shape.kind === "square") return column === 0 || column === columns - 1 || row === 0 || row === rows - 1;
    if (!shapeCellRange(shape, row, bounds).includes(column)) return false;
    const radiusX = bounds.width / 2 - GRID;
    const radiusY = bounds.height / 2 - GRID;
    if (radiusX <= 0 || radiusY <= 0) return true;
    const cellX = bounds.x + (column + 0.5) * GRID;
    const cellY = bounds.y + (row + 0.5) * GRID;
    return ((cellX - (bounds.x + bounds.width / 2)) / radiusX) ** 2 + ((cellY - (bounds.y + bounds.height / 2)) / radiusY) ** 2 > 1;
  }

  function drawToken(token, scale) {
    const widthTiles = Math.max(1, Math.round(Number(token.widthTiles) || (Number(token.radius) || 22) * 2 / GRID));
    const heightTiles = Math.max(1, Math.round(Number(token.heightTiles) || (Number(token.radius) || 22) * 2 / GRID));
    const width = widthTiles * GRID;
    const height = heightTiles * GRID;
    const left = token.x - width / 2;
    const top = token.y - height / 2;
    const label = token.name || "Token";
    const character = mapState.health?.characters?.find(item => String(item.linkedTokenId) === String(token.id));
    let portrait = character?.imageDataUrl ? tokenImageCache.get(character.imageDataUrl) : null;
    if (character?.imageDataUrl && !portrait) {
      portrait = new Image();
      portrait.addEventListener("load", renderMap, { once: true });
      portrait.src = character.imageDataUrl;
      tokenImageCache.set(character.imageDataUrl, portrait);
    }
    if (portrait && (!portrait.complete || !portrait.naturalWidth)) portrait = null;
    context.save();
    context.globalAlpha = opacityOf(token);
    context.beginPath();
    context.rect(left, top, width, height);
    context.fillStyle = token.color || "#d87054";
    context.fill();
    if (portrait) {
      context.save();
      context.clip();
      context.drawImage(portrait, left, top, width, height);
      context.restore();
    }
    context.beginPath();
    context.rect(left, top, width, height);
    context.lineWidth = 2 / scale;
    context.strokeStyle = "#f0dfca";
    context.stroke();
    if (!portrait) {
      context.fillStyle = "#fff4e9";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${Math.max(10, Math.min(width, height) * 0.28)}px Manrope, sans-serif`;
      context.fillText(label.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(), token.x, token.y);
    }
    context.restore();

    if (!hideTokenNames) {
      context.save();
      const labelFontSize = Math.max(8, Math.min(11, 11 * scale));
      const maxLabelWidth = 160 / scale;
      context.font = `600 ${labelFontSize / scale}px Manrope, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "top";
      const labelWidth = Math.min(context.measureText(label).width, maxLabelWidth);
      const labelY = top + height + 5 / scale;
      context.fillStyle = "#171a19e8";
      context.fillRect(token.x - labelWidth / 2 - 5 / scale, labelY, labelWidth + 10 / scale, (labelFontSize + 7) / scale);
      context.fillStyle = "#e5e7dc";
      context.fillText(label, token.x, labelY + 3 / scale, maxLabelWidth);
      context.restore();
    }

    const health = token.health;
    if (scale >= 0.85 && health && Number(health.vitalityMax) > 0 && Number(health.lucidityMax) > 0) {
      const barWidth = Math.max(8 / scale, width - 8 / scale);
      const barX = token.x - barWidth / 2;
      const barY = labelY + 21 / scale;
      context.fillStyle = "#171a19e8";
      context.fillRect(barX - 2 / scale, barY - 2 / scale, barWidth + 4 / scale, 22 / scale);
      context.font = `600 ${Math.max(7, 8 / scale)}px Manrope, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const vitalityText = `VIT ${Number(health.vitality).toLocaleString("pt-BR")} / ${Number(health.vitalityMax).toLocaleString("pt-BR")}`;
      const lucidityText = `LUC ${Number(health.lucidity).toLocaleString("pt-BR")} / ${Number(health.lucidityMax).toLocaleString("pt-BR")}`;
      context.fillStyle = "#df8568";
      context.fillRect(barX, barY + 8 / scale, barWidth * Math.max(0, Math.min(1, health.vitality / health.vitalityMax)), 3 / scale);
      if (scale >= 1.5) {
        context.fillStyle = "#fff4e9";
        context.fillText(vitalityText, token.x, barY + 4 / scale);
      }
      context.fillStyle = "#91b8c3";
      context.fillRect(barX, barY + 19 / scale, barWidth * Math.max(0, Math.min(1, health.lucidity / health.lucidityMax)), 3 / scale);
      if (scale >= 1.5) {
        context.fillStyle = "#fff4e9";
        context.fillText(lucidityText, token.x, barY + 15 / scale);
      }
    }
    context.restore();

    if (mapState.initiative?.activeTokenId === token.id) {
      context.save();
      context.beginPath();
      context.rect(left - 9 / scale, top - 9 / scale, width + 18 / scale, height + 18 / scale);
      context.strokeStyle = "#f4c95d";
      context.lineWidth = 2.5 / scale;
      context.stroke();
      context.restore();
    }
  }

  function drawPin(pin, scale) {
    context.save();
    context.translate(pin.x, pin.y);
    context.scale(1 / scale, 1 / scale);
    context.beginPath();
    context.moveTo(0, 14);
    context.bezierCurveTo(-4, 7, -12, 0, -12, -7);
    context.arc(0, -7, 12, Math.PI, 0);
    context.bezierCurveTo(12, 0, 4, 7, 0, 14);
    context.closePath();
    context.fillStyle = pin.color || "#e36b57";
    context.shadowColor = "#111512";
    context.shadowBlur = 4;
    context.fill();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(0, -7, 4, 0, Math.PI * 2);
    context.fillStyle = "#fff4e9";
    context.fill();
    context.restore();
  }

  function renderMap() {
    const boundsOnScreen = canvas.getBoundingClientRect();
    const width = boundsOnScreen.width;
    const height = boundsOnScreen.height;
    if (!width || !height) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#171a19";
    context.fillRect(0, 0, width, height);

    const map = normalizedMap();
    const bounds = mapBounds(map);
    const path = boardPath(map, bounds);

    context.save();
    context.translate(width / 2 + panX, height / 2 + panY);
    context.scale(zoom, zoom);
    const visibleLeft = (-width / 2 - panX) / zoom;
    const visibleTop = (-height / 2 - panY) / zoom;
    context.fillStyle = "#111512c9";
    context.fillRect(visibleLeft, visibleTop, width / zoom, height / zoom);
    context.fillStyle = "#252b27";
    context.fill(path);
    context.save();
    context.clip(path);
    if (mapState.gridVisible !== false) drawGrid(map, bounds, zoom);
    drawTiles(Array.isArray(mapState.tiles) ? mapState.tiles : []);
    for (const shape of Array.isArray(mapState.shapes) ? mapState.shapes : []) drawShape(shape);
    for (const token of Array.isArray(mapState.tokens) ? mapState.tokens : []) drawToken(token, zoom);
    for (const pin of Array.isArray(mapState.pins) ? mapState.pins : []) drawPin(pin, zoom);
    context.restore();
    context.strokeStyle = "#c58ca1";
    context.lineWidth = 2 / zoom;
    context.stroke(boardOutlinePath(map, bounds));
    context.restore();
  }

  function updateMap(nextState) {
    if (!nextState || !Array.isArray(nextState.tokens) || !Array.isArray(nextState.tiles) || !Array.isArray(nextState.shapes)) return;
    mapState = nextState;
    renderMap();
  }

  function updateZoomReadout() {
    panel.querySelector('[data-map-zoom="reset"]').textContent = `${Math.round(zoom * 100)}%`;
  }

  function zoomAt(factor, point) {
    const bounds = panel.getBoundingClientRect();
    const nextZoom = Math.max(0.02, Math.min(2.5, zoom * factor));
    const worldX = (point.x - bounds.width / 2 - panX) / zoom;
    const worldY = (point.y - bounds.height / 2 - panY) / zoom;
    panX = point.x - bounds.width / 2 - worldX * nextZoom;
    panY = point.y - bounds.height / 2 - worldY * nextZoom;
    zoom = nextZoom;
    updateZoomReadout();
    renderMap();
  }

  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-map-zoom]");
    if (!button) return;
    const bounds = panel.getBoundingClientRect();
    if (button.dataset.mapZoom === "reset") {
      zoom = 1;
      panX = 0;
      panY = 0;
      updateZoomReadout();
      renderMap();
      return;
    }
    zoomAt(button.dataset.mapZoom === "in" ? 1.2 : 1 / 1.2, { x: bounds.width / 2, y: bounds.height / 2 });
  });

  const hideTokenNamesButton = panel.querySelector("[data-map-labels]");
  const setTokenNamesHidden = hidden => {
    hideTokenNames = hidden;
    hideTokenNamesButton.setAttribute("aria-pressed", String(hidden));
    renderMap();
  };
  hideTokenNamesButton.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    hideTokenNamesButton.setPointerCapture(event.pointerId);
    setTokenNamesHidden(true);
  });
  hideTokenNamesButton.addEventListener("pointerup", () => setTokenNamesHidden(false));
  hideTokenNamesButton.addEventListener("pointercancel", () => setTokenNamesHidden(false));
  hideTokenNamesButton.addEventListener("lostpointercapture", () => setTokenNamesHidden(false));
  hideTokenNamesButton.addEventListener("keydown", event => {
    if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
      event.preventDefault();
      setTokenNamesHidden(true);
    }
  });
  hideTokenNamesButton.addEventListener("keyup", event => {
    if (event.code === "Space" || event.code === "Enter") setTokenNamesHidden(false);
  });
  window.addEventListener("blur", () => setTokenNamesHidden(false));

  panel.addEventListener("wheel", event => {
    event.preventDefault();
    const bounds = panel.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.08 : 1 / 1.08, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }, { passive: false });

  panel.addEventListener("pointerdown", event => {
    if (event.target.closest(".player-map-zoom")) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
    panel.setPointerCapture(event.pointerId);
  });
  panel.addEventListener("pointermove", event => {
    if (!panPointer || panPointer.id !== event.pointerId) return;
    panX = panPointer.panX + event.clientX - panPointer.x;
    panY = panPointer.panY + event.clientY - panPointer.y;
    renderMap();
  });
  const stopPanning = event => {
    if (!panPointer || panPointer.id !== event.pointerId) return;
    panPointer = null;
  };
  panel.addEventListener("pointerup", stopPanning);
  panel.addEventListener("pointercancel", stopPanning);
  panel.addEventListener("contextmenu", event => event.preventDefault());

  const stateChannel = "BroadcastChannel" in window ? new BroadcastChannel(STORAGE_KEY) : null;
  stateChannel?.addEventListener("message", event => {
    if (event.data?.type === "state") updateMap(event.data.state);
  });
  window.StonePlateDisplayMap = { update: updateMap, resize: renderMap };
  window.addEventListener("resize", renderMap);
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { updateMap(JSON.parse(event.newValue)); }
    catch (error) { console.warn("Não foi possível atualizar o mapa da projeção.", error); }
  });
  renderMap();
})();
