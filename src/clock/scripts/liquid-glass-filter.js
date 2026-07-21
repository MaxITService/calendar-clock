// Generates and applies SVG/canvas displacement maps for the liquid-glass magnifier lens.
function surfaceFn(x) {
            return Math.pow(1 - Math.pow(1 - x, 4), 0.25);
        }

        function calcRefractionProfile(glassThickness, bezelWidth, ior, samples = 128) {
            const eta = 1 / ior;

            function refract(nx, ny) {
                const dot = ny;
                const k = 1 - eta * eta * (1 - dot * dot);
                if (k < 0) return null;
                const sq = Math.sqrt(k);
                return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
            }

            const p = new Float64Array(samples);
            for (let i = 0; i < samples; i++) {
                const x = i / samples;
                const y = surfaceFn(x);
                const dx = x < 1 ? 0.0001 : -0.0001;
                const y2 = surfaceFn(x + dx);
                const deriv = (y2 - y) / dx;
                const mag = Math.sqrt(deriv * deriv + 1);
                const ref = refract(-deriv / mag, -1 / mag);
                p[i] = ref ? ref[0] * ((y * bezelWidth + glassThickness) / ref[1]) : 0;
            }
            return p;
        }

        function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: false });
            const img = ctx.createImageData(w, h);
            const d = img.data;

            for (let i = 0; i < d.length; i += 4) {
                d[i] = 128;
                d[i + 1] = 128;
                d[i + 2] = 0;
                d[i + 3] = 255;
            }

            const r = radius;
            const rSq = r * r;
            const r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2;
            const hB = h - r * 2;
            const S = profile.length;

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;

                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;

                    const cos = x / dist;
                    const sin = y / dist;
                    const bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1);
                    const disp = profile[bi] || 0;
                    const dX = (-cos * disp) / maxDisp;
                    const dY = (-sin * disp) / maxDisp;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = (128 + dX * 127 * op + 0.5) | 0;
                    d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0;
                }
            }

            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        function generateSpecularMap(w, h, radius, bezelWidth, balanced) {
            const angle = Math.PI / 3;
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: false });
            const img = ctx.createImageData(w, h);
            const d = img.data;
            d.fill(0);

            const r = radius;
            const rSq = r * r;
            const r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2;
            const hB = h - r * 2;
            const sv = [Math.cos(angle), Math.sin(angle)];

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;

                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;

                    const cos = x / dist;
                    const sin = -y / dist;
                    const dot = balanced ? 1 : Math.abs(cos * sv[0] + sin * sv[1]);
                    const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
                    const coeff = dot * edge;
                    const col = (255 * coeff) | 0;
                    const alpha = (col * coeff * op) | 0;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = col;
                    d[idx + 1] = col;
                    d[idx + 2] = col;
                    d[idx + 3] = alpha;
                }
            }

            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        function generateEdgeBlurMask(w, h, radius, sharpAreaRatio, transitionRatio) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: false });
            const img = ctx.createImageData(w, h);
            const d = img.data;
            const cx = w / 2;
            const cy = h / 2;
            const sharpArea = Math.max(0, Math.min(1, sharpAreaRatio));
            const sharpRadius = radius * Math.sqrt(sharpArea);
            const transition = Math.max(1, radius * Math.max(0.01, transitionRatio));

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                    const idx = (y * w + x) * 4;
                    const t = Math.max(0, Math.min(1, (dist - sharpRadius) / transition));
                    const alpha = dist <= radius ? t * t * (3 - 2 * t) : 0;
                    d[idx] = 255;
                    d[idx + 1] = 255;
                    d[idx + 2] = 255;
                    d[idx + 3] = Math.round(255 * alpha);
                }
            }

            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        function svgEl(tag, attrs) {
            const el = document.createElementNS(SVG_NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
            return el;
        }

        function ensureLiquidGlassDefs() {
            const old = document.getElementById("clock-liquid-glass-defs");
            if (old && document.documentElement.contains(old)) {
                liquidGlassDefsEl = old;
                return;
            }

            const svg = document.createElementNS(SVG_NS, "svg");
            svg.setAttribute("width", "0");
            svg.setAttribute("height", "0");
            svg.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:-1;";
            liquidGlassDefsEl = document.createElementNS(SVG_NS, "defs");
            liquidGlassDefsEl.id = "clock-liquid-glass-defs";
            svg.appendChild(liquidGlassDefsEl);
            document.documentElement.appendChild(svg);
        }

        function buildLiquidGlassFilter(id, w, h, radius, cfg) {
            const bezel = Math.max(1, Math.min(cfg.bezelWidth, radius - 1, Math.min(w, h) / 2 - 1));
            const profile = calcRefractionProfile(cfg.glassThickness, bezel, cfg.ior, 128);
            const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
            const dispUrl = generateDisplacementMap(w, h, radius, bezel, profile, maxDisp);
            const edgeBlurMaskUrl = generateEdgeBlurMask(w, h, radius, cfg.sharpCenterArea, cfg.blurTransitionRatio);
            const scale = maxDisp * cfg.scaleRatio;
            const pad = 0.08;
            const fx = Math.round(-w * pad);
            const fy = Math.round(-h * pad);
            const fw = Math.round(w * (1 + pad * 2));
            const fh = Math.round(h * (1 + pad * 2));

            const filter = svgEl("filter", {
                id,
                x: String(fx),
                y: String(fy),
                width: String(fw),
                height: String(fh),
                filterUnits: "userSpaceOnUse",
                primitiveUnits: "userSpaceOnUse",
                "color-interpolation-filters": "sRGB"
            });

            const blur = svgEl("feGaussianBlur", {
                in: "SourceGraphic",
                stdDeviation: cfg.blur,
                result: "blurred"
            });
            const dispImg = svgEl("feImage", {
                href: dispUrl,
                x: 0,
                y: 0,
                width: w,
                height: h,
                result: "disp_map"
            });
            const dispMap = svgEl("feDisplacementMap", {
                in: "blurred",
                in2: "disp_map",
                scale,
                xChannelSelector: "R",
                yChannelSelector: "G",
                result: "displaced"
            });
            const edgeBlurMask = svgEl("feImage", {
                href: edgeBlurMaskUrl,
                x: 0,
                y: 0,
                width: w,
                height: h,
                result: "edge_blur_mask"
            });
            const edgeBlurOnly = svgEl("feComposite", {
                in: "displaced",
                in2: "edge_blur_mask",
                operator: "in",
                result: "edge_blur_only"
            });
            const merged = svgEl("feMerge", {});
            merged.append(
                svgEl("feMergeNode", { in: "SourceGraphic" }),
                svgEl("feMergeNode", { in: "edge_blur_only" })
            );

            filter.append(blur, dispImg, dispMap, edgeBlurMask, edgeBlurOnly, merged);
            return filter;
        }

        function rebuildLensLiquidGlass() {
            ensureLiquidGlassDefs();

            const rect = lensWindowEl.getBoundingClientRect();
            const w = Math.round(lensWindowEl.offsetWidth || rect.width);
            const h = Math.round(lensWindowEl.offsetHeight || rect.height);
            if (w < 8 || h < 8) return;

            const radius = Math.max(2, Math.min(w, h) / 2);
            if (lensLiquidGlassFilterEl) lensLiquidGlassFilterEl.remove();

            const id = "clock-lg-lens-" + Math.random().toString(36).slice(2, 10);
            lensLiquidGlassFilterEl = buildLiquidGlassFilter(id, w, h, radius, LIQUID_GLASS_CONFIG);
            liquidGlassDefsEl.appendChild(lensLiquidGlassFilterEl);

            /*
                Important fix:
                Do not use backdrop-filter here. A transparent backdrop-filter layer samples
                the original, unmagnified clock behind the lens.

                Also do not filter .magnified-clock directly. That element is a large translated
                clone of the clock, so the SVG lens map would become a huge/static second lens.
                The filter belongs on the lens-sized viewport wrapper instead.
            */
            lensGlassRefractionEl.style.backdropFilter = "none";
            lensGlassRefractionEl.style.webkitBackdropFilter = "none";
            magnifiedClockEl.style.filter = "none";
            magnifiedContentEl.style.filter = `url(#${id}) brightness(.95) contrast(.96) saturate(.94)`;

            lensGlassTintEl.style.backgroundColor = `rgba(${LIQUID_GLASS_CONFIG.tintColor},${LIQUID_GLASS_CONFIG.tintOpacity})`;
            lensGlassTintEl.style.boxShadow = `
                inset 0 0 ${LIQUID_GLASS_CONFIG.innerShadowBlur}px ${LIQUID_GLASS_CONFIG.innerShadowSpread}px ${LIQUID_GLASS_CONFIG.innerShadow},
                inset 0 0 0 1px rgba(255,255,255,.52),
                inset 1.4vmin 1.4vmin 3.8vmin rgba(255,255,255,.22),
                inset -2.8vmin -3vmin 5.8vmin rgba(83,55,30,.16)
            `;
        }

        function scheduleLensLiquidGlassRebuild() {
            clearTimeout(lensGlassRebuildTimer);
            lensGlassRebuildTimer = setTimeout(rebuildLensLiquidGlass, 32);
        }

