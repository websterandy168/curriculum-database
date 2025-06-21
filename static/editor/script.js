document.addEventListener('DOMContentLoaded', () => {

    const canvas = new fabric.Canvas('editor-canvas', {
        backgroundColor: 'white'
    });

    let isTextEditing = false;
    let isDimensionMode = false;
    let dimensionStartPoint = null;
    let tempLine = null;
    let isPolygonMode = false;
    let polygonPoints = [];
    let tempPolygonLines = [];
    let isSnapToGridEnabled = false;
    const gridSize = 20; // Define your grid size in pixels
    let tempFollowLine = null;
    let gridLines = [];
    let clipboard = null;
    const CUSTOM_PROPERTIES = ['custom_type', 'initialRadius', 'sides', 'angleDeg', 'alt'];

    const propertiesPanel = document.getElementById('properties-panel');
    const propertiesContent = document.getElementById('properties-content');
    const modalOverlay = document.getElementById('custom-modal-overlay');
    const canvasContainer = document.querySelector('.canvas-container');
    const unitSelector = document.getElementById('unit-selector');

    let currentUnit = 'px';
    const DPI = 96; // A standard assumption for web
    const units = {
        px: { factor: 1, label: 'px', areaLabel: 'px²' },
        in: { factor: DPI, label: 'in', areaLabel: 'in²' },
        cm: { factor: DPI / 2.54, label: 'cm', areaLabel: 'cm²' }
    };
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const modalOkBtn = document.getElementById('modal-ok-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    let infoBox = null;

    canvas.on('text:editing:entered', () => {
        isTextEditing = true;
    });
    canvas.on('text:editing:exited', () => {
        isTextEditing = false;
        canvas.renderAll(); // Re-render to show selection handles if needed
    });

    // --- Responsive Canvas ---
    function resizeCanvas() {
        const containerWidth = canvasContainer.offsetWidth;
        const containerHeight = canvasContainer.offsetHeight;

        canvas.setWidth(containerWidth);
        canvas.setHeight(containerHeight);
        canvas.calcOffset();
        canvas.renderAll();

        // If grid is shown, redraw it to fit new size
        const showGridCheckbox = document.getElementById('show-grid-toggle');
        if (showGridCheckbox && showGridCheckbox.checked) {
            clearGrid();
            drawGrid();
        }
    }

    // Create and append the info box for real-time drawing feedback
    infoBox = document.createElement('div');
    infoBox.className = 'info-box';
    document.body.appendChild(infoBox);

    function copyActiveObject() {
        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        activeObject.clone(function(clonedObj) {
            clipboard = clonedObj;
        }, CUSTOM_PROPERTIES);
    }

    function pasteObject() {
        if (!clipboard) return;

        clipboard.clone(function(clonedObj) {
            canvas.discardActiveObject(); // Deselect current object
            
            // Offset the pasted object slightly
            clonedObj.set({
                left: clonedObj.left + 10,
                top: clonedObj.top + 10,
                evented: true, // Ensure it's interactive
            });

            // If it's a group (activeSelection), iterate and add each object
            if (clonedObj.type === 'activeSelection') {
                clonedObj.canvas = canvas; // Assign canvas to the group for proper rendering
                clonedObj.forEachObject(function(obj) {
                    canvas.add(obj);
                });
                // Reselect the group
                clonedObj.setCoords();
                canvas.setActiveObject(clonedObj);
            } else {
                canvas.add(clonedObj);
                canvas.setActiveObject(clonedObj);
            }
            canvas.renderAll();
        }, CUSTOM_PROPERTIES);
    }

    function cutActiveObject() {
        copyActiveObject();
        deleteActiveObject();
    }

    function showCustomPrompt({ title, fields }) {
        return new Promise((resolve) => {
            modalTitle.textContent = title;
            modalContent.innerHTML = ''; // Clear previous content
    
            fields.forEach(field => {
                const group = document.createElement('div');
                group.className = 'modal-input-group';
                
                let input;
                if (field.type === 'select') {
                    input = document.createElement('select');
                    field.options.forEach(option => {
                        const opt = document.createElement('option');
                        opt.value = option.value;
                        opt.textContent = option.label;
                        input.appendChild(opt);
                    });
                } else if (field.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.rows = field.rows || 4;
                } else {
                    input = document.createElement('input');
                    input.type = field.type || 'text';
                }

                const label = document.createElement('label');
                label.setAttribute('for', field.id);
                label.textContent = field.label;
                
                input.id = field.id;
                input.name = field.id;
                input.placeholder = field.placeholder || '';
                if (field.value) input.value = field.value;
                
                group.appendChild(label);
                group.appendChild(input);
                modalContent.appendChild(group);
            });
    
            modalOverlay.classList.remove('hidden');
            modalContent.querySelector('input, select, textarea')?.focus();
    
            const modalKeydownHandler = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent this event from bubbling up to the window listener
                    modalOkBtn.onclick();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent this event from bubbling up to the window listener
                    modalCancelBtn.onclick();
                }
            };

            const close = () => {
                modalOverlay.classList.add('hidden');
                modalOkBtn.onclick = null;
                modalCancelBtn.onclick = null;
                modalOverlay.onclick = null;
                document.removeEventListener('keydown', modalKeydownHandler);
            };
    
            modalOkBtn.onclick = () => {
                const result = {};
                fields.forEach(field => {
                    const element = document.getElementById(field.id);
                    result[field.id] = element.value;
                });
                close();
                resolve(result);
            };
    
            modalCancelBtn.onclick = () => {
                close();
                resolve(null); // Resolve with null to match prompt's cancel behavior
            };
    
            modalOverlay.onclick = (e) => { if (e.target === modalOverlay) modalCancelBtn.onclick(); };
            document.addEventListener('keydown', modalKeydownHandler);
        });
    }

    const addTextButton = document.getElementById('add-text');
    addTextButton.addEventListener('click', async () => {
        const result = await showCustomPrompt({ title: 'Add Text', fields: [{ id: 'text', label: 'Enter your text:' }] });
        if (result && result.text) {
            const textbox = new fabric.Textbox(result.text, {
                left: 50, top: 50, width: 200, fontSize: 24, fill: '#000000',
                padding: 7, fontFamily: 'Roboto'
            });
            canvas.add(textbox);
            canvas.setActiveObject(textbox);
        }
    });

    const imageLoader = document.getElementById('image-loader');
    imageLoader.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fileName = file.name; // Capture file name for alt text
        const reader = new FileReader();
        reader.onload = (f) => {
            const data = f.target.result;
            fabric.Image.fromURL(data, (img) => {
                img.set({ left: 100, top: 100 });
                img.scaleToWidth(200);
                img.set({ alt: `User uploaded image: ${fileName}` }); // Add alt text for screen readers
                canvas.add(img);
            });
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });
    
    function createTapeDiagram(segments) {
        const boxWidth = 80;
        const boxHeight = 60;
        const strokeColor = '#333';
        const fillColor = 'rgba(255, 255, 255, 0)';
        const strokeWidth = 2;
        const diagramParts = [];
        for (let i = 0; i < segments; i++) {
            const box = new fabric.Rect({
                left: i * boxWidth,
                top: 0,
                width: boxWidth,
                height: boxHeight,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: strokeWidth
            });
            diagramParts.push(box);
        }
        const tapeDiagram = new fabric.Group(diagramParts, {
            left: 150,
            top: 150,
            lockScalingFlip: true,
        });
        canvas.add(tapeDiagram);
        canvas.setActiveObject(tapeDiagram);
        canvas.renderAll();
    }

    const renderLatex = (latexString) => {
        if (!latexString) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css" />`;
        const mathEl = document.createElement('span');
        tempDiv.appendChild(mathEl);
        try {
            mathEl.style.fontSize = '30px';
            mathEl.style.color = 'black';
            tempDiv.style.padding = '10px';
            katex.render(latexString, mathEl, { throwOnError: true });
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            document.body.appendChild(tempDiv);
            html2canvas(tempDiv, {
                backgroundColor: null,
                scale: 3
            }).then(canvasElement => {
                const dataUrl = canvasElement.toDataURL('image/png');
                fabric.Image.fromURL(dataUrl, (img) => {
                    img.set({ left: 150, top: 150 });
                    img.set({ alt: latexString }); // Add alt text for screen readers
                    img.scaleToWidth(80);
                    canvas.add(img);
                    canvas.setActiveObject(img);
                    canvas.renderAll();
                    document.body.removeChild(tempDiv);
                });
            });
        } catch (error) {
            console.error("KaTeX rendering failed:", error);
            if (tempDiv.parentElement) {
                document.body.removeChild(tempDiv);
            }
            alert(`Failed to render math equation:\n\n${error.message}`);
        }
    };

    function resetPolygonMode() {
        // Remove all temporary visual guides
        tempPolygonLines.forEach(line => canvas.remove(line));
        if (tempFollowLine) {
            canvas.remove(tempFollowLine);
        }
        
        // Reset state variables
        isPolygonMode = false;
        polygonPoints = [];
        tempPolygonLines = [];
        tempFollowLine = null;

        // Reset canvas to default state
        canvas.defaultCursor = 'default';
        canvas.selection = true;
        canvas.forEachObject(obj => obj.set('selectable', true));

        // Hide the info box
        if (infoBox) infoBox.style.display = 'none';
        canvas.renderAll();
    }

    function createPolygonFromPoints() {
        // Remove temporary lines and circle before creating the final polygon
        if (polygonPoints.length < 3) {
            resetPolygonMode(); // Not a valid polygon, just cancel
            return;
        }

        const polygon = new fabric.Polygon(polygonPoints, {
            fill: 'rgba(173, 216, 230, 0.5)', // Light blue, semi-transparent
            stroke: '#333',
            strokeWidth: 2,
            lockScalingFlip: true,
            custom_type: 'FreehandPolygon',
        });

        canvas.add(polygon);
        canvas.setActiveObject(polygon);
        // Call resetPolygonMode to clean up temp lines AND the info box
        resetPolygonMode();
    }

    function createTriangle(side1, side2, side3) {
        // Check if valid triangle (Triangle Inequality Theorem)
        if (side1 + side2 <= side3 || side1 + side3 <= side2 || side2 + side3 <= side1) {
            alert("Invalid triangle: The sum of any two sides must be greater than the third side.");
            return null;
        }
        // Use side1 as the base, calculate the height
        const semiPerimeter = (side1 + side2 + side3) / 2;
        const area = Math.sqrt(semiPerimeter * (semiPerimeter - side1) * (semiPerimeter - side2) * (semiPerimeter - side3));
        const height = (2 * area) / side1;

        // Calculate x-coordinate of the third vertex using Pythagorean theorem
        const x = (Math.pow(side1, 2) + Math.pow(side2, 2) - Math.pow(side3, 2)) / (2 * side1);

        const points = [
            { x: 0, y: 0 },
            { x: side1, y: 0 },
            { x: x, y: height }
        ];

        const triangle = new fabric.Polygon(points, {
            left: 150,
            top: 150,
            fill: 'rgba(255, 200, 100, 0.5)',
            stroke: '#333',
            strokeWidth: 2,
            lockScalingFlip: true,
            custom_type: 'Triangle',
        });
        canvas.add(triangle);
        canvas.setActiveObject(triangle);
        canvas.renderAll();
    }

    function createParallelogram(side1, side2, angleDeg) {
        // Ensure angle is within valid range
        if (angleDeg <= 0 || angleDeg >= 180) {
            alert("Angle must be between 0 and 180 degrees.");
            return;
        }
        const angleRad = fabric.util.degreesToRadians(angleDeg);

        const points = [
            { x: 0, y: 0 },
            { x: side1, y: 0 },
            { x: side1 + side2 * Math.cos(Math.PI - angleRad), y: side2 * Math.sin(angleRad) },
            { x: side2 * Math.cos(Math.PI - angleRad), y: side2 * Math.sin(angleRad) }
        ];

        const parallelogram = new fabric.Polygon(points, {
            left: 150,
            top: 150,
            fill: 'rgba(200, 255, 200, 0.5)',
            stroke: '#333',
            strokeWidth: 2,
            lockScalingFlip: true,
            custom_type: 'Parallelogram',
        });
        canvas.add(parallelogram);
        canvas.setActiveObject(parallelogram);
        canvas.renderAll();
    }

    const addTriangleBtn = document.getElementById('add-triangle-btn');
    addTriangleBtn.addEventListener('click', async () => {
        const unitInfo = units[currentUnit];
        const result = await showCustomPrompt({ title: 'Create Triangle', fields: [
            { id: 'side1', label: `Side 1 (${unitInfo.label}):`, type: 'number' },
            { id: 'side2', label: `Side 2 (${unitInfo.label}):`, type: 'number' },
            { id: 'side3', label: `Side 3 (${unitInfo.label}):`, type: 'number' }
        ]});
        if (result && result.side1 && result.side2 && result.side3) {
            const conversionFactor = unitInfo.factor;
            createTriangle(
                parseFloat(result.side1) * conversionFactor,
                parseFloat(result.side2) * conversionFactor,
                parseFloat(result.side3) * conversionFactor
            );
        }
    });

    const addParallelogramBtn = document.getElementById('add-parallelogram-btn');
    addParallelogramBtn.addEventListener('click', async () => {
        const unitInfo = units[currentUnit];
        const result = await showCustomPrompt({ title: 'Create Parallelogram', fields: [
            { id: 'side1', label: `Side 1 (${unitInfo.label}):`, type: 'number' },
            { id: 'side2', label: `Side 2 (${unitInfo.label}):`, type: 'number' },
            { id: 'angle', label: 'Angle (degrees):', type: 'number' }
        ]});
        if (result && result.side1 && result.side2 && result.angle) {
            const conversionFactor = unitInfo.factor;
            createParallelogram(
                parseFloat(result.side1) * conversionFactor,
                parseFloat(result.side2) * conversionFactor,
                parseFloat(result.angle)
            );
        }
    });

    function createNgon(sides, radius = 60) {
        const points = [];
        const angleStep = (Math.PI * 2) / sides;
        // Start with the first point at the top for better visual orientation
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < sides; i++) {
            points.push({
                x: radius * Math.cos(startAngle + i * angleStep),
                y: radius * Math.sin(startAngle + i * angleStep)
            });
        }

        const ngon = new fabric.Polygon(points, {
            left: 150,
            top: 150,
            fill: 'rgba(100, 100, 255, 0.5)',
            stroke: '#333',
            strokeWidth: 2,
            lockScalingFlip: true,
            custom_type: 'Ngon',
            sides: sides, // Store the number of sides here
            initialRadius: radius,
        });
        canvas.add(ngon);
        canvas.setActiveObject(ngon);
        canvas.renderAll();
    }

    function createWedge(radius, angle) {
        if (angle <= 0 || angle >= 360) {
            // For a full circle, just create a circle object
            const circle = new fabric.Circle({
                radius: radius,
                fill: 'rgba(100, 200, 100, 0.5)',
                stroke: '#333',
                strokeWidth: 2,
                left: 150,
                top: 150,
                custom_type: 'Circle',
            });
            canvas.add(circle);
            canvas.setActiveObject(circle);
            return;
        }

        const angleRad = fabric.util.degreesToRadians(angle);
        const largeArcFlag = angle > 180 ? 1 : 0;
        const endX = radius * Math.cos(angleRad);
        const endY = radius * Math.sin(angleRad);

        // M 0,0 L radius,0 A radius,radius 0 largeArcFlag,1 endX,endY Z
        const path = `M 0 0 L ${radius} 0 A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} z`;

        const wedge = new fabric.Path(path, {
            left: 150, top: 150,
            fill: 'rgba(100, 200, 100, 0.5)',
            stroke: '#333', strokeWidth: 2,
            lockScalingFlip: true,
            custom_type: 'Wedge',
            initialRadius: radius,
            angleDeg: angle,
        });

        canvas.add(wedge);
        canvas.setActiveObject(wedge);
        canvas.renderAll();
    }

    function addPolygonPoint(point) {
        // Check for closing the polygon
        if (polygonPoints.length > 2) {
            const firstPoint = polygonPoints[0];
            const distance = Math.sqrt(Math.pow(point.x - firstPoint.x, 2) + Math.pow(point.y - firstPoint.y, 2));
            if (distance < 10) {
                createPolygonFromPoints();
                return;
            }
        }

        polygonPoints.push(point);

        if (polygonPoints.length > 1) {
            const start = polygonPoints[polygonPoints.length - 2];
            const end = polygonPoints[polygonPoints.length - 1];
            const line = new fabric.Line([start.x, start.y, end.x, end.y], {
                stroke: '#aaa', strokeWidth: 2, selectable: false, evented: false,
            });
            tempPolygonLines.push(line);
            canvas.add(line);
        }

        if (polygonPoints.length === 1) {
            const startCircle = new fabric.Circle({
                radius: 5, fill: 'rgba(100,100,255,0.5)', left: point.x, top: point.y,
                originX: 'center', originY: 'center', selectable: false, evented: false,
            });
            tempPolygonLines.push(startCircle);
            canvas.add(startCircle);
        }
        canvas.renderAll();
    }

    async function addPreciseSegment() {
        if (!isPolygonMode || polygonPoints.length < 1) return;
        const unitInfo = units[currentUnit];
        const result = await showCustomPrompt({ title: 'Add Precise Segment', fields: [{
            id: 'segment',
            label: `Length (${unitInfo.label}), Angle`,
            placeholder: `e.g., ${(100 / unitInfo.factor).toFixed(1)}, 45`
        }] });

        if (result && result.segment) {
            const parts = result.segment.split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                let [length, angleDeg] = parts;
                length *= unitInfo.factor; // Convert length to pixels
                const angleRad = fabric.util.degreesToRadians(angleDeg);
                const lastPoint = polygonPoints[polygonPoints.length - 1];
                // Calculate next point based on math angle (0=right, 90=up), inverting Y for screen coordinates
                const nextPoint = { x: lastPoint.x + length * Math.cos(angleRad), y: lastPoint.y - length * Math.sin(angleRad) };
                addPolygonPoint(nextPoint);
            } else { alert("Invalid format. Please use 'length, angle'."); }
        }
    }

    function getAbsolutePoints(polygon) {
        const matrix = polygon.calcTransformMatrix();
        return polygon.points.map(p => fabric.util.transformPoint(p, matrix));
    }

    function showPropertiesPlaceholder() {
        propertiesPanel.classList.remove('hidden');
        propertiesContent.innerHTML = `<p class="placeholder-text">Select an object on the canvas to view its properties.</p>`;
    }

    showPropertiesPlaceholder();

    function createPropertyRow(label, value, propertyName = null, object = null, type = 'text') {
        const row = document.createElement('div');
        row.className = 'prop-group';
        const input = document.createElement('input');
        input.type = type;
        input.value = value;
        
        if (propertyName && object) {
            input.dataset.property = propertyName;

            const eventType = (type === 'color') ? 'input' : 'change';
            input.addEventListener(eventType, (e) => {
                if (type === 'text') {
                    handlePropertyChange(e, object);
                } else { // For color, etc.
                    object.set(propertyName, e.target.value);
                    canvas.renderAll();
                }
            });
        } else {
            input.disabled = true;
        }

        row.innerHTML = `<label>${label}</label>`;
        row.appendChild(input);
        propertiesContent.appendChild(row);
    }

    function populateCircleProperties(circle) {
        const unitInfo = units[currentUnit];
        const conversionFactor = unitInfo.factor;

        const radius_px = circle.radius * circle.scaleX;
        const radius_units = radius_px / conversionFactor;
        const circumference_units = (2 * Math.PI * radius_px) / conversionFactor;
        const area_px = Math.PI * Math.pow(radius_px, 2);
        const area_units = area_px / (conversionFactor * conversionFactor);

        createPropertyRow('Type', 'Circle', null, circle);
        createPropertyRow(`Radius (${unitInfo.label})`, radius_units.toFixed(2), 'radius', circle);
        createPropertyRow(`Circumference (${unitInfo.label})`, circumference_units.toFixed(2), 'circumference', circle);
        createPropertyRow(`Area (${unitInfo.areaLabel})`, area_units.toFixed(2), 'area', circle);
        createPropertyRow('Fill Color', circle.get('fill'), 'fill', circle, 'color');
        createPropertyRow('Stroke Color', circle.get('stroke'), 'stroke', circle, 'color');
    }

    function populateNgonProperties(ngon) {
        const unitInfo = units[currentUnit];
        const conversionFactor = unitInfo.factor;

        const scaledRadius_px = ngon.initialRadius * ngon.scaleX;
        const interiorAngleDeg = (ngon.sides - 2) * 180 / ngon.sides;
        const sideLength_px = 2 * scaledRadius_px * Math.sin(Math.PI / ngon.sides);
        const area_px = 0.5 * ngon.sides * Math.pow(scaledRadius_px, 2) * Math.sin((2 * Math.PI) / ngon.sides);

        createPropertyRow('Type', `${ngon.sides}-gon`, null, ngon);
        createPropertyRow('Interior Angle (°)', interiorAngleDeg.toFixed(2), null, ngon);
        createPropertyRow(`Side Length (${unitInfo.label})`, (sideLength_px / conversionFactor).toFixed(2), 'sideLength', ngon);
        createPropertyRow(`Area (${unitInfo.areaLabel})`, (area_px / (conversionFactor * conversionFactor)).toFixed(2), 'area', ngon);
        createPropertyRow(`Circumradius (${unitInfo.label})`, (scaledRadius_px / conversionFactor).toFixed(2), 'circumradius', ngon);
        createPropertyRow('Fill Color', ngon.get('fill'), 'fill', ngon, 'color');
        createPropertyRow('Stroke Color', ngon.get('stroke'), 'stroke', ngon, 'color');
    }

    function populateWedgeProperties(wedge) {
        const unitInfo = units[currentUnit];
        const conversionFactor = unitInfo.factor;

        const scaledRadius_px = wedge.initialRadius * wedge.scaleX;
        const area_px = Math.PI * Math.pow(scaledRadius_px, 2) * (wedge.angleDeg / 360);
        const arcLength_px = 2 * Math.PI * scaledRadius_px * (wedge.angleDeg / 360);

        createPropertyRow('Type', 'Wedge / Arc', null, wedge);
        createPropertyRow(`Radius (${unitInfo.label})`, (scaledRadius_px / conversionFactor).toFixed(2), 'radius', wedge);
        createPropertyRow('Angle (°)', wedge.angleDeg.toFixed(2), null, wedge);
        createPropertyRow(`Arc Length (${unitInfo.label})`, (arcLength_px / conversionFactor).toFixed(2), 'arcLength', wedge);
        createPropertyRow(`Area (${unitInfo.areaLabel})`, (area_px / (conversionFactor * conversionFactor)).toFixed(2), 'area', wedge);
        createPropertyRow('Fill Color', wedge.get('fill'), 'fill', wedge, 'color');
        createPropertyRow('Stroke Color', wedge.get('stroke'), 'stroke', wedge, 'color');
    }

    // Helper to calculate interior angle at a vertex
    function calculateInteriorAngle(p_prev, p_curr, p_next) {
        const v1 = { x: p_prev.x - p_curr.x, y: p_prev.y - p_curr.y }; // Vector from p_curr to p_prev
        const v2 = { x: p_next.x - p_curr.x, y: p_next.y - p_curr.y }; // Vector from p_curr to p_next

        const dotProduct = v1.x * v2.x + v1.y * v2.y;

        // Calculate magnitudes
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        // Avoid division by zero if a segment has zero length
        if (mag1 === 0 || mag2 === 0) {
            return 0; // Or handle as an error/invalid angle
        }

        // Calculate cosine of the angle
        const cosAngle = dotProduct / (mag1 * mag2);

        // Clamp cosAngle to [-1, 1] to avoid floating point errors with Math.acos
        const clampedCos = Math.max(-1, Math.min(1, cosAngle));

        // Calculate angle in radians (will be between 0 and PI) and convert to degrees
        return fabric.util.radiansToDegrees(Math.acos(clampedCos));
    }

    function populateFreehandPolygonProperties(polygon, typeName = 'Polygon') {
        const unitInfo = units[currentUnit];
        const conversionFactor = unitInfo.factor;

        createPropertyRow('Type', typeName, null, polygon);
        const absPoints = getAbsolutePoints(polygon);
        const numPoints = absPoints.length;
        absPoints.forEach((p1, i) => {
            const p2 = absPoints[(i + 1) % numPoints];
            const length = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            createPropertyRow(`Side ${i + 1} Len. (${unitInfo.label})`, (length / conversionFactor).toFixed(2), null, polygon); // Length of side starting at vertex i

            // Calculate interior angle at vertex i
            const p_prev = absPoints[(i - 1 + numPoints) % numPoints];
            const interiorAngleDeg = calculateInteriorAngle(p_prev, p1, p2);
            createPropertyRow(`Vertex ${i + 1} Angle (°)`, interiorAngleDeg.toFixed(2), null, polygon);
        });
        createPropertyRow('Fill Color', polygon.get('fill'), 'fill', polygon, 'color');
        createPropertyRow('Stroke Color', polygon.get('stroke'), 'stroke', polygon, 'color');
    }

    function updatePropertiesPanel() {
        const activeObject = canvas.getActiveObject();
        propertiesContent.innerHTML = '';

        if (!activeObject || activeObject.type === 'activeSelection') {
            showPropertiesPlaceholder();
            return;
        }

        const type = activeObject.custom_type || activeObject.type;

        switch (type) {
            case 'Circle':
            case 'circle':
                populateCircleProperties(activeObject);
                break;
            case 'Ngon':
                populateNgonProperties(activeObject);
                break;
            case 'Wedge':
                populateWedgeProperties(activeObject);
                break;
            case 'Triangle':
                populateFreehandPolygonProperties(activeObject, 'Triangle');
                break;
            case 'Parallelogram':
                populateFreehandPolygonProperties(activeObject, 'Parallelogram');
                break;
            case 'FreehandPolygon':
                populateFreehandPolygonProperties(activeObject, 'Polygon');
                break;
            // Groups and other unhandled types will fall through
            default:
                showPropertiesPlaceholder();
                return;
        }
        propertiesPanel.classList.remove('hidden');
    }

    function handlePropertyChange(e, obj) {
        const input = e.target;
        const property = input.dataset.property;
        let newValue = parseFloat(input.value);

        if (isNaN(newValue) || !obj) return;

        const unitInfo = units[currentUnit];
        const conversionFactor = unitInfo.factor;
        let scaleFactor = 1;

        // Convert input value from current units back to pixels
        if (property === 'area') {
            newValue *= (conversionFactor * conversionFactor); // Area is squared
        } else {
            newValue *= conversionFactor; // Linear dimension
        }

        // Calculate the required scaling factor based on the property changed
        const type = obj.custom_type || obj.type;
        switch (type) {
            case 'Circle':
            case 'circle':
                if (property === 'radius') scaleFactor = newValue / (obj.radius * obj.scaleX);
                else if (property === 'circumference') scaleFactor = newValue / (2 * Math.PI * obj.radius * obj.scaleX);
                else if (property === 'area') scaleFactor = Math.sqrt(newValue / (Math.PI * Math.pow(obj.radius * obj.scaleX, 2)));
                break;
            case 'Ngon':
                const scaledRadius_px = obj.initialRadius * obj.scaleX;
                if (property === 'sideLength') scaleFactor = newValue / (2 * scaledRadius_px * Math.sin(Math.PI / obj.sides));
                else if (property === 'circumradius') scaleFactor = newValue / scaledRadius_px;
                else if (property === 'area') scaleFactor = Math.sqrt(newValue / (0.5 * obj.sides * Math.pow(scaledRadius_px, 2) * Math.sin((2 * Math.PI) / obj.sides)));
                break;
            case 'Wedge':
                const wedgeRadius_px = obj.initialRadius * obj.scaleX;
                if (property === 'radius') scaleFactor = newValue / wedgeRadius_px;
                else if (property === 'arcLength') scaleFactor = newValue / (2 * Math.PI * wedgeRadius_px * (obj.angleDeg / 360));
                else if (property === 'area') scaleFactor = Math.sqrt(newValue / (Math.PI * Math.pow(wedgeRadius_px, 2) * (obj.angleDeg / 360)));
                break;
        }

        if (scaleFactor !== 1 && isFinite(scaleFactor) && scaleFactor > 0) {
            obj.scale(obj.scaleX * scaleFactor).setCoords();
            canvas.renderAll();
            // After scaling, refresh the properties panel to update all values
            updatePropertiesPanel();
        } else {
            // If input was invalid or resulted in no change, revert to original value
            updatePropertiesPanel();
        }
    }

    unitSelector.addEventListener('change', (e) => {
        currentUnit = e.target.value;
        const activeObject = canvas.getActiveObject();
        if (activeObject) { updatePropertiesPanel(); }
    });

    canvas.on({
        'selection:created': updatePropertiesPanel,
        'selection:updated': updatePropertiesPanel,
        'selection:cleared': showPropertiesPlaceholder,
        'object:modified': updatePropertiesPanel
    });

    const tapeDiagramBtn = document.getElementById('tape-diagram-btn');
    tapeDiagramBtn.addEventListener('click', async () => {
        const result = await showCustomPrompt({ title: 'Tape Diagram', fields: [{ id: 'segments', label: 'How many segments?', type: 'number' }] });
        if (result && result.segments) {
            const numSegments = parseInt(result.segments, 10);
            if (!isNaN(numSegments) && numSegments > 0) {
                createTapeDiagram(numSegments);
            } else {
                alert('Please enter a valid number greater than 0.');
            }
        }
    });

    function createDimension(start, end, labelText) {
        const line = new fabric.Line([start.x, start.y, end.x, end.y], {
            stroke: '#333',
            strokeWidth: 2,
        });

        const tickSize = 10; // Length of the perpendicular tick
        const angle = Math.atan2(end.y - start.y, end.x - start.x); // Angle of the main dimension line in radians
        const angleDeg = fabric.util.radiansToDegrees(angle); // Angle in degrees for the label

        // Calculate points for the perpendicular ticks
        // The angle perpendicular to the main line
        const perpAngle = angle + Math.PI / 2; 

        // For tick1 at 'start' point
        const tick1_x1 = start.x + (tickSize / 2) * Math.cos(perpAngle);
        const tick1_y1 = start.y + (tickSize / 2) * Math.sin(perpAngle);
        const tick1_x2 = start.x - (tickSize / 2) * Math.cos(perpAngle);
        const tick1_y2 = start.y - (tickSize / 2) * Math.sin(perpAngle);

        const tick1 = new fabric.Line([tick1_x1, tick1_y1, tick1_x2, tick1_y2], {
            stroke: '#333',
            strokeWidth: 2,
        });

        // For tick2 at 'end' point
        const tick2_x1 = end.x + (tickSize / 2) * Math.cos(perpAngle);
        const tick2_y1 = end.y + (tickSize / 2) * Math.sin(perpAngle);
        const tick2_x2 = end.x - (tickSize / 2) * Math.cos(perpAngle);
        const tick2_y2 = end.y - (tickSize / 2) * Math.sin(perpAngle);

        const tick2 = new fabric.Line([tick2_x1, tick2_y1, tick2_x2, tick2_y2], {
            stroke: '#333',
            strokeWidth: 2,
        });

        // Position the label above the center of the line
        const textOffset = 15;
        const midPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

        // Calculate offset perpendicular to the line
        const offsetX = textOffset * Math.sin(angle);
        const offsetY = textOffset * Math.cos(angle);

        const label = new fabric.Textbox(labelText, {
            left: midPoint.x - offsetX,
            top: midPoint.y + offsetY,
            fontSize: 18,
            fill: '#000000',
            fontFamily: 'Roboto',
            textAlign: 'center',
            originX: 'center',
            originY: 'center', // Keep origin for text rotation
            angle: angleDeg,
            width: labelText.length * 12, // Give it an initial sensible width
        });

        // If the text is upside down, flip it for readability
        if (angleDeg > 90 || angleDeg < -90) {
            label.set({
                angle: angleDeg + 180,
                left: midPoint.x + offsetX,
                top: midPoint.y - offsetY,
            });
        }

        const dimensionGroup = new fabric.Group([line, tick1, tick2, label], {
            lockScalingFlip: true,
            subTargetCheck: true, // Allows editing text within the group
        });

        canvas.add(dimensionGroup);
        canvas.setActiveObject(dimensionGroup);
    }

    const addDimensionBtn = document.getElementById('add-dimension-btn');
    addDimensionBtn.addEventListener('click', () => {
        isDimensionMode = true;
        canvas.defaultCursor = 'crosshair';
        canvas.selection = false; // Disable object selection
        canvas.forEachObject(obj => obj.set('selectable', false));
        canvas.renderAll();
    });

    const addPolygonBtn = document.getElementById('add-polygon-btn');
    addPolygonBtn.addEventListener('click', () => {
        isPolygonMode = true;
        canvas.defaultCursor = 'crosshair';
        canvas.selection = false;
        canvas.forEachObject(obj => obj.set('selectable', false));
        canvas.renderAll();
    });

    const addWedgeBtn = document.getElementById('add-wedge-btn');
    addWedgeBtn.addEventListener('click', async () => {
        const unitInfo = units[currentUnit];
        const result = await showCustomPrompt({ title: 'Create Arc/Wedge', fields: [
            { id: 'radius', label: `Radius (${unitInfo.label}):`, type: 'number', value: (100 / unitInfo.factor).toFixed(2) },
            { id: 'angle', label: 'Angle (degrees):', type: 'number', value: 90 }
        ]});
        if (result && result.radius && result.angle) {
            const conversionFactor = unitInfo.factor;
            createWedge(parseFloat(result.radius) * conversionFactor, parseFloat(result.angle));
        }
    });

    const addNgonBtn = document.getElementById('add-ngon-btn');
    const ngonSidesSelect = document.getElementById('ngon-sides');
    addNgonBtn.addEventListener('click', () => createNgon(parseInt(ngonSidesSelect.value, 10)));
    
    canvas.on('mouse:down', async (o) => {
        const pointer = canvas.getPointer(o.e);

        if (isDimensionMode && !isTextEditing) { // Ensure not in text editing mode
            if (!dimensionStartPoint) {
                dimensionStartPoint = { x: pointer.x, y: pointer.y };
                tempLine = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: '#aaa', strokeWidth: 2, strokeDashArray: [5, 5]
                });
                canvas.add(tempLine);
        } else {
            // Second click: create the dimension object
            const result = await showCustomPrompt({ title: 'Dimension Label', fields: [{ id: 'label', label: 'Enter label for the dimension:' }] });
            const endPoint = { x: pointer.x, y: pointer.y }; // Allow freehand end point
            if (result) { // Only create if user doesn't cancel
                createDimension(dimensionStartPoint, endPoint, result.label);
            }
            // Cleanup and exit dimension mode
            canvas.remove(tempLine);
            tempLine = null;
            dimensionStartPoint = null;
            isDimensionMode = false;
            canvas.defaultCursor = 'default';
            canvas.selection = true;
            if (infoBox) infoBox.style.display = 'none'; // Hide info box on completion
            canvas.forEachObject(obj => obj.set('selectable', true));
            canvas.renderAll();
        }
        } else if (isPolygonMode) {
            addPolygonPoint({ x: pointer.x, y: pointer.y });
        }
    });

    canvas.on('mouse:move', (o) => {
        const pointer = canvas.getPointer(o.e);
        if (isDimensionMode && dimensionStartPoint && tempLine && !isTextEditing) {
            tempLine.set({ x2: pointer.x, y2: pointer.y }); // Allow freehand movement

            // Update info box for dimension mode
            const length = Math.sqrt(Math.pow(pointer.x - dimensionStartPoint.x, 2) + Math.pow(pointer.y - dimensionStartPoint.y, 2));
            const horizontalAngleRad = Math.atan2(-(pointer.y - dimensionStartPoint.y), pointer.x - dimensionStartPoint.x);
            let horizontalAngleDeg = fabric.util.radiansToDegrees(horizontalAngleRad);
            if (horizontalAngleDeg < 0) horizontalAngleDeg += 360; // Normalize to 0-360

            let infoText = `L: ${length.toFixed(1)}<br>Abs ∠: ${horizontalAngleDeg.toFixed(1)}°`;
            infoText += `<br>---<br>Tab for precise input`;

            infoBox.innerHTML = infoText;
            infoBox.style.display = 'block';
            infoBox.style.left = `${o.e.clientX + 15}px`;
            infoBox.style.top = `${o.e.clientY + 15}px`;

            canvas.renderAll();
        } else if (isPolygonMode && polygonPoints.length > 0) {
            // Existing polygon info box logic
            // ... (no changes here, as it's already working)
            // The rest of the polygon mouse:move logic remains the same
            const lastPoint = polygonPoints[polygonPoints.length - 1];
            if (tempFollowLine) canvas.remove(tempFollowLine);
            tempFollowLine = new fabric.Line([lastPoint.x, lastPoint.y, pointer.x, pointer.y], { stroke: '#aaa', strokeWidth: 2, strokeDashArray: [5, 5], selectable: false, evented: false });
            canvas.add(tempFollowLine);

            const length = Math.sqrt(Math.pow(pointer.x - lastPoint.x, 2) + Math.pow(pointer.y - lastPoint.y, 2));
            const horizontalAngleRad = Math.atan2(-(pointer.y - lastPoint.y), pointer.x - lastPoint.x);
            let horizontalAngleDeg = fabric.util.radiansToDegrees(horizontalAngleRad);
            if (horizontalAngleDeg < 0) horizontalAngleDeg += 360;

            let infoText = `L: ${length.toFixed(1)}<br>Abs ∠: ${horizontalAngleDeg.toFixed(1)}°`;

            if (polygonPoints.length > 1) {
                const prevPoint = polygonPoints[polygonPoints.length - 2];
                const v1 = { x: prevPoint.x - lastPoint.x, y: prevPoint.y - lastPoint.y };
                const v2 = { x: pointer.x - lastPoint.x, y: pointer.y - lastPoint.y };

                const dotProduct = v1.x * v2.x + v1.y * v2.y;
                const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
                const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
                
                if (mag1 > 0 && mag2 > 0) {
                    const cosAngle = dotProduct / (mag1 * mag2);
                    const clampedCos = Math.max(-1, Math.min(1, cosAngle));
                    const relativeAngleRad = Math.acos(clampedCos);
                    const relativeAngleDeg = fabric.util.radiansToDegrees(relativeAngleRad);
                    infoText += `<br>Rel ∠: ${relativeAngleDeg.toFixed(1)}°`;
                }
            }

            infoText += `<br>---<br>Tab for precise input`;

            infoBox.innerHTML = infoText;
            infoBox.style.display = 'block';
            infoBox.style.left = `${o.e.clientX + 15}px`;
            infoBox.style.top = `${o.e.clientY + 15}px`;

            canvas.renderAll();
        } else {
            if (infoBox) infoBox.style.display = 'none';
        }
    });

    async function addPreciseDimensionSegment() {
        if (!isDimensionMode || !dimensionStartPoint) return;
        const unitInfo = units[currentUnit];
        const result = await showCustomPrompt({
            title: 'Add Precise Dimension',
            fields: [
                { id: 'segment', label: `Length (${unitInfo.label}), Angle (0=right, 90=up):`, placeholder: `e.g., ${(150 / unitInfo.factor).toFixed(1)}, 30` },
                { id: 'label', label: 'Label for dimension:' }
            ]
        });

        if (result && result.segment) {
            const parts = result.segment.split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                let [length, angleDeg] = parts;
                length *= unitInfo.factor; // Convert length to pixels
                const angleRad = fabric.util.degreesToRadians(angleDeg);
                
                // Calculate end point based on start point, length, and angle
                const endX = dimensionStartPoint.x + length * Math.cos(angleRad);
                const endY = dimensionStartPoint.y - length * Math.sin(angleRad); // Invert Y for screen coordinates
                
                createDimension(dimensionStartPoint, { x: endX, y: endY }, result.label || '');

                // Cleanup and exit dimension mode
                canvas.remove(tempLine);
                tempLine = null;
                dimensionStartPoint = null;
                isDimensionMode = false;
                canvas.defaultCursor = 'default';
                canvas.selection = true;
                if (infoBox) infoBox.style.display = 'none';
                canvas.forEachObject(obj => obj.set('selectable', true));
                canvas.renderAll();
            } else {
                alert("Invalid format. Please use 'length, angle'.");
            }
        } else {
            // User cancelled, reset dimension mode
            canvas.remove(tempLine);
            tempLine = null;
            dimensionStartPoint = null;
            isDimensionMode = false;
            canvas.defaultCursor = 'default';
            canvas.selection = true;
            if (infoBox) infoBox.style.display = 'none';
            canvas.forEachObject(obj => obj.set('selectable', true));
            canvas.renderAll();
        }
    }

    // Main keyboard event listener
    window.addEventListener('keydown', async (e) => {
        if (!modalOverlay.classList.contains('hidden')) {
            // Modal is active, let its own handlers do the work.
            return;
        }

        const isCtrlCmd = e.ctrlKey || e.metaKey; // metaKey for Cmd on Mac

        // Handle native browser copy/paste/cut within text fields
        if (isTextEditing) {
            if (isCtrlCmd && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
                return; // Allow native browser behavior
            }
        }

        // --- Global Shortcuts (Copy, Paste, Cut, Delete) ---
        if (isCtrlCmd && e.key === 'c') {
            e.preventDefault();
            copyActiveObject();
            return;
        }
        if (isCtrlCmd && e.key === 'v') {
            e.preventDefault();
            pasteObject();
            return;
        }
        if (isCtrlCmd && e.key === 'x') {
            e.preventDefault();
            cutActiveObject();
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (isTextEditing) return; // Don't delete objects if typing text
            e.preventDefault();
            deleteActiveObject();
            return;
        }

        // --- Arrow Key Movement ---
        const activeObject = canvas.getActiveObject();
        if (activeObject && !isTextEditing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const moveAmount = isSnapToGridEnabled ? gridSize : 1;

            switch (e.key) {
                case 'ArrowLeft':
                    activeObject.left -= moveAmount;
                    break;
                case 'ArrowRight':
                    activeObject.left += moveAmount;
                    break;
                case 'ArrowUp':
                    activeObject.top -= moveAmount;
                    break;
                case 'ArrowDown':
                    activeObject.top += moveAmount;
                    break;
            }
            activeObject.setCoords();
            canvas.renderAll();
            return;
        }

        // --- Mode-Specific Shortcuts ---
        if (isPolygonMode) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (polygonPoints.length >= 3) createPolygonFromPoints();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                resetPolygonMode();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (infoBox) infoBox.style.display = 'none';
                await addPreciseSegment();
            }
        } else if (isDimensionMode) {
            if (e.key === 'Tab' && dimensionStartPoint) {
                e.preventDefault();
                if (infoBox) infoBox.style.display = 'none';
                await addPreciseDimensionSegment();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // Cleanup and exit dimension mode
                canvas.remove(tempLine);
                tempLine = null;
                dimensionStartPoint = null;
                isDimensionMode = false;
                canvas.defaultCursor = 'default';
                canvas.selection = true;
                if (infoBox) infoBox.style.display = 'none';
                canvas.forEachObject(obj => obj.set('selectable', true));
                canvas.renderAll();
            }
        }
    });

    const latexButtons = document.querySelectorAll('.latex-btn');
    latexButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const template = button.getAttribute('data-template');
            let latexString = '';
            let result;

            if (template === 'fraction') {
                result = await showCustomPrompt({ title: 'Create Fraction', fields: [
                    { id: 'num', label: 'Numerator:' }, { id: 'den', label: 'Denominator:' }
                ]});
                if (result) {
                    latexString = `\\frac{${result.num}}{${result.den}}`;
                }
            } else if (template === 'sqrt') {
                result = await showCustomPrompt({ title: 'Create Square Root', fields: [{ id: 'content', label: 'Content:' }] });
                if (result) {
                    latexString = `\\sqrt{${result.content}}`;
                }
            } else if (template === 'power') {
                result = await showCustomPrompt({ title: 'Create Exponent', fields: [
                    { id: 'base', label: 'Base:' }, { id: 'exp', label: 'Exponent:' }
                ]});
                if (result) {
                    latexString = `${result.base}^{${result.exp}}`;
                }
            }
            renderLatex(latexString);
        });
    });

    const customLatexBtn = document.getElementById('custom-latex-btn');
    customLatexBtn.addEventListener('click', async () => {
        const result = await showCustomPrompt({
            title: 'Custom LaTeX Input',
            fields: [{
                id: 'latex',
                label: 'Enter your LaTeX expression:',
                placeholder: 'e.g., \\sum_{i=0}^n i^2'
            }]
        });

        if (result && result.latex) {
            renderLatex(result.latex);
        }
    });

    function deleteActiveObject() {
        const activeObject = canvas.getActiveObject();
        if (activeObject) {
            if (activeObject.type === 'activeSelection') {
                activeObject.forEachObject(function(obj) {
                    canvas.remove(obj);
                });
            } else {
                canvas.remove(activeObject);
            }
            canvas.discardActiveObject();
            canvas.renderAll();
        }
    }

    function drawGrid() {
        clearGrid(); // Clear any existing grid first
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const strokeColor = '#e0e0e0'; // A light gray for the grid

        // Draw vertical lines
        for (let i = 1; i < canvasWidth / gridSize; i++) {
            const line = new fabric.Line([i * gridSize, 0, i * gridSize, canvasHeight], {
                stroke: strokeColor,
                selectable: false,
                evented: false,
            });
            canvas.add(line);
            line.sendToBack();
            gridLines.push(line);
        }

        // Draw horizontal lines
        for (let i = 1; i < canvasHeight / gridSize; i++) {
            const line = new fabric.Line([0, i * gridSize, canvasWidth, i * gridSize], {
                stroke: strokeColor,
                selectable: false,
                evented: false,
            });
            canvas.add(line);
            line.sendToBack();
            gridLines.push(line);
        }
        canvas.renderAll();
    }

    function clearGrid() {
        gridLines.forEach(line => canvas.remove(line));
        gridLines = [];
        canvas.renderAll();
    }

    const snapToGridToggle = document.getElementById('snap-to-grid-toggle');
    snapToGridToggle.addEventListener('change', (e) => {
        isSnapToGridEnabled = e.target.checked;
    });

    const showGridToggle = document.getElementById('show-grid-toggle');
    showGridToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            drawGrid();
        } else {
            clearGrid();
        }
    });

    canvas.on('object:moving', (options) => {
        if (isSnapToGridEnabled) {
            options.target.set({
                left: Math.round(options.target.left / gridSize) * gridSize,
                top: Math.round(options.target.top / gridSize) * gridSize
            });
        }
    });

    const exportButton = document.getElementById('export-jpeg');
    exportButton.addEventListener('click', () => {
        const link = document.createElement('a');
        // Increase resolution with a multiplier and set quality to maximum for a sharper image.
        link.href = canvas.toDataURL({
            format: 'jpeg',
            quality: 1.0, // Use maximum quality to reduce graininess
            multiplier: 2 // Render at 2x resolution to reduce blurriness
        });
        link.download = 'my-creation.jpeg';
        link.click();
    });

    // --- New functionality: Add to Worksheet DB ---
    const addToDbBtn = document.getElementById('add-to-db-btn');
    addToDbBtn.addEventListener('click', async () => {
        // These grade levels should ideally be fetched from the Flask app's API
        // but for simplicity, hardcoding a common set here.
        const gradeLevels = [
            { value: "Pre-Kindergarten", label: "Pre-Kindergarten" },
            { value: "Kindergarten", label: "Kindergarten" },
            { value: "1st Grade", label: "1st Grade" },
            { value: "2nd Grade", label: "2nd Grade" },
            { value: "3rd Grade", label: "3rd Grade" },
            { value: "4th Grade", label: "4th Grade" },
            { value: "5th Grade", label: "5th Grade" },
            { value: "6th Grade", label: "6th Grade" },
            { value: "7th Grade", label: "7th Grade" },
            { value: "8th Grade", label: "8th Grade" },
            { value: "9th Grade", label: "9th Grade" },
            { value: "10th Grade", label: "10th Grade" },
            { value: "11th Grade", label: "11th Grade" },
            { value: "12th Grade", label: "12th Grade" }
        ];

        const result = await showCustomPrompt({
            title: 'Add Task to Worksheet Database',
            fields: [
                { id: 'taskTitle', label: 'Task Title:', type: 'text', placeholder: 'e.g., Area of a Triangle' },
                { id: 'taskDescription', label: 'Description (optional):', type: 'textarea', rows: 2, placeholder: 'Brief internal description' },
                { id: 'taskGrade', label: 'Grade Level:', type: 'select', options: gradeLevels },
                { id: 'taskBodyText', label: 'Body Text (optional, supports HTML/LaTeX):', type: 'textarea', rows: 4, placeholder: 'e.g., <p>Solve for x:</p>$$x^2=4$$' }
            ]
        });

        if (result) {
            // Convert canvas to data URL (PNG for better quality and transparency)
            const imageDataUrl = canvas.toDataURL({
                format: 'png',
                quality: 1.0, // Max quality
                multiplier: 2 // Render at 2x resolution for sharper image
            });

            const payload = {
                title: result.taskTitle,
                description: result.taskDescription,
                grade_level: result.taskGrade,
                body_text: result.taskBodyText,
                image_data: imageDataUrl
            };

            // Get the CSRF token from the meta tag in the page's <head>
            const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

            try {
                // The editor and API are on the same origin, so we use a relative path.
                // We also include the CSRF token for security.
                const response = await fetch('/api/add_visual_task', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const data = await response.json();
                    alert(`Task "${result.taskTitle}" added successfully to Worksheet Database! Task ID: ${data.task_id}`);
                } else {
                    const errorData = await response.json();
                    alert(`Failed to add task: ${errorData.error || response.statusText}. Make sure you are logged into the Worksheet Database.`);
                    console.error('Failed to add task:', errorData);
                }
            } catch (error) {
                alert(`An error occurred while connecting to the Worksheet Database: ${error.message}. Is the database server running?`);
                console.error('Network error:', error);
            }
        }
    });

    // --- Initial Setup and Event Listeners for Responsiveness ---
    // Perform an initial resize to set the canvas size correctly on load
    resizeCanvas();
    // Add a listener to resize the canvas whenever the window size changes
    window.addEventListener('resize', resizeCanvas);
});