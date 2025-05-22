let currentMazeId = null;

async function generateMaze() {
    const rows = document.getElementById('rows').value;
    const cols = document.getElementById('cols').value;
    
    // Show loading state
    document.getElementById('maze-container').innerHTML = '<div style="padding: 20px; text-align: center;">Generating maze...</div>';

    try {
        const response = await fetch('/api/maze/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                width: parseInt(cols),
                height: parseInt(rows)
            })
        });
        
        const mazeData = await response.json();
        console.log(">>> maze data = ", mazeData);
        currentMazeId = mazeData.id;

        displayMaze(mazeData.mazeData);
    } catch (error) {
        console.error("Error generating maze:", error);
        document.getElementById('maze-container').innerHTML = 
            '<div style="padding: 20px; color: var(--danger); text-align: center;">Error generating maze. Please try again.</div>';
    }
}

async function saveMaze() {
    const mazeName = document.getElementById('mazeName').value;
    if (!mazeName) {
        showNotification('Please enter a name for the maze', 'error');
        return;
    }

    const mazeContainer = document.getElementById('maze-container');
    if (!mazeContainer.children.length) {
        showNotification('Please generate a maze first', 'error');
        return;
    }
    
    const rows = mazeContainer.children.length;
    const cols = mazeContainer.children[0].children.length;

    const mazeData = [];
    for (let i = 0; i < rows; i++) {
        const row = [];
        for (let j = 0; j < cols; j++) {
            const cell = mazeContainer.children[i].children[j];
            row.push(cell.classList.contains('wall') || cell.style.backgroundColor === '#1F2937' ? 1 : 0);
        }
        mazeData.push(row);
    }

    try {
        const response = await fetch('/api/maze/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: mazeName,
                width: cols,
                height: rows,
                mazeData: mazeData.map(row => row.join('')).join('\n')
            })
        });

        const savedMaze = await response.json();
        console.log(">>> saved maze = ", savedMaze);
        currentMazeId = savedMaze.id;
        
        // Refresh the saved mazes list
        await loadSavedMazesList();
        showNotification('Maze saved successfully!', 'success');
    } catch (error) {
        console.error("Error saving maze:", error);
        showNotification('Error saving maze. Please try again.', 'error');
    }
}

function showNotification(message, type = 'success') {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `
        <div class="result-${type}">
            <p style="font-weight: 500;">${message}</p>
        </div>
    `;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        resultDiv.innerHTML = '';
    }, 3000);
}

async function loadSavedMazesList() {
    try {
        const response = await fetch('/api/maze');
        const mazes = await response.json();
        
        const mazeListContainer = document.getElementById('saved-mazes-list');
        mazeListContainer.innerHTML = '';
        
        if (mazes.length === 0) {
            mazeListContainer.innerHTML = '<p style="text-align: center; color: var(--gray);">No saved mazes yet.</p>';
            return;
        }
        
        mazes.forEach(maze => {
            const mazeItem = document.createElement('div');
            mazeItem.className = 'maze-item';
            mazeItem.innerHTML = `
                <strong>${maze.name}</strong>
                <span style="font-size: 0.8rem; color: var(--gray-dark);">Size: ${maze.width}x${maze.height}</span><br>
                <span style="font-size: 0.7rem; color: var(--gray);">${new Date(maze.createdAt).toLocaleString()}</span>
            `;
            mazeItem.onclick = () => loadSavedMaze(maze.id);
            mazeListContainer.appendChild(mazeItem);
        });
    } catch (error) {
        console.error('Error loading saved mazes:', error);
        document.getElementById('saved-mazes-list').innerHTML = 
            '<p style="text-align: center; color: var(--danger);">Error loading saved mazes. Please try again.</p>';
    }
}

async function loadSavedMaze(mazeId) {
    try {
        const response = await fetch(`/api/maze/${mazeId}`);
        const maze = await response.json();
        
        currentMazeId = maze.id;
        displayMaze(maze.mazeData);
        
        // Update the name input field
        document.getElementById('mazeName').value = maze.name;
        
        // Scroll to the maze
        document.getElementById('maze-container').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Error loading maze:', error);
        showNotification('Error loading maze. Please try again.', 'error');
    }
}

function displayMaze(mazeData) {
    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    const mazeRows = mazeData.trim().split('\n');
    
    mazeRows.forEach((rowStr, rowIndex) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'maze-row';

        const cells = rowStr.split('');
        cells.forEach((cell, colIndex) => {
            const cellDiv = document.createElement('div');
            cellDiv.className = 'maze-cell';
            
            if (cell === '1') {
                cellDiv.classList.add('wall');
                cellDiv.style.backgroundColor = '#1F2937';
            } else {
                cellDiv.classList.add('path');
                cellDiv.style.backgroundColor = 'white';
            }
            
            // Add special styling for start and end points
            if (rowIndex === 0 && colIndex === 0) {
                cellDiv.classList.add('start-point');
            }
            
            if (rowIndex === mazeRows.length - 1 && colIndex === cells.length - 1) {
                cellDiv.classList.add('end-point');
            }
            
            rowDiv.appendChild(cellDiv);
        });

        mazeContainer.appendChild(rowDiv);
    });
    
    // Clear any previous result
    document.getElementById('result').innerHTML = '';
}

function displaySolvedMaze(solvedMaze) {
    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    for (let i = 0; i < solvedMaze.length; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'maze-row';

        for (let j = 0; j < solvedMaze[i].length; j++) {
            const cellDiv = document.createElement('div');
            cellDiv.className = 'maze-cell';
            
            // Special handling for start and end points
            if (i === 0 && j === 0) {
                // Start point
                cellDiv.classList.add('start-point');
                cellDiv.title = 'Start';
            } else if (i === solvedMaze.length - 1 && j === solvedMaze[i].length - 1) {
                // End point
                cellDiv.classList.add('end-point');
                cellDiv.title = 'End';
            } else {
                // 0 = path, 1 = wall, 2 = solution path
                if (solvedMaze[i][j] === 1) {
                    cellDiv.classList.add('wall');
                    cellDiv.title = 'Wall';
                } else if (solvedMaze[i][j] === 2) {
                    cellDiv.classList.add('solution');
                    cellDiv.title = 'Solution Path';
                } else {
                    cellDiv.classList.add('path');
                    cellDiv.title = 'Path';
                }
            }
            
            rowDiv.appendChild(cellDiv);
        }

        mazeContainer.appendChild(rowDiv);
    }
}

async function solveMaze2() {
    const mazeContainer = document.getElementById('maze-container');
    if (!mazeContainer.children.length) {
        showNotification('Please generate a maze first', 'error');
        return;
    }
    
    const rows = mazeContainer.children.length;
    const cols = mazeContainer.children[0].children.length;

    // Show loading state
    document.getElementById('result').innerHTML = `
        <div style="padding: 15px; background-color: var(--gray-light); border-radius: 8px; text-align: center;">
            <p>Solving maze...</p>
        </div>
    `;

    const maze = [];
    for (let i = 0; i < rows; i++) {
        const row = [];
        for (let j = 0; j < cols; j++) {
            const cell = mazeContainer.children[i].children[j];
            // Check both class and background color to handle both initial and solution views
            row.push(cell.classList.contains('wall') || cell.style.backgroundColor === '#1F2937' ? 1 : 0);
        }
        maze.push(row);
    }

    try {
        const response = await fetch('/api/maze/solve', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ maze }),
        });

        const result = await response.json();
        console.log("Solve result:", result);
        
        if (result.solved) {
            // Display the solved maze with the path
            displaySolvedMaze(result.solvedMaze);
            document.getElementById('result').innerHTML = `
                <div class="result-success">
                    <p style="font-weight: 500;">${result.message}</p>
                    <details>
                        <summary>View Path Details</summary>
                        <p>${result.path}</p>
                    </details>
                </div>
            `;
        } else {
            document.getElementById('result').innerHTML = `
                <div class="result-error">
                    <p style="font-weight: 500;">${result.message}</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error solving maze:', error);
        document.getElementById('result').innerHTML = `
            <div class="result-error">
                <p style="font-weight: 500;">Error solving maze. Please try again.</p>
            </div>
        `;
    }
}