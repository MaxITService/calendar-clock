// Applies the default lens size and wires lens dragging; the frame renders no local controls.
function applyDefaultLensSize() {
            document.documentElement.style.setProperty("--lens-size", LENS_DEFAULT_SIZE + "px");
        }

        magnifierEl.addEventListener("pointerdown", event => {
            if (!autoMagnifierActive) return;

            event.preventDefault();
            event.stopPropagation();

            startAutoMagnifierExit();
        });
