let currentMazeId = null;

async function generateMaze() {
    const rows = document.getElementById('rows').value;
    const cols = document.getElementById('cols').value;

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
}

async function saveMaze() {
    const mazeName = document.getElementById('mazeName').value;
    if (!mazeName) {
        alert('Please enter a name for the maze');
        return;
    }

    const mazeContainer = document.getElementById('maze-container');
    const rows = mazeContainer.children.length;
    const cols = mazeContainer.children[0].children.length;

    const mazeData = [];
    for (let i = 0; i < rows; i++) {
        const row = [];
        for (let j = 0; j < cols; j++) {
            const cell = mazeContainer.children[i].children[j];
            row.push(cell.style.backgroundColor === 'black' ? 1 : 0);
        }
        mazeData.push(row);
    }

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
    alert('Maze saved successfully!');
}

async function loadSavedMazesList() {
    try {
        const response = await fetch('/api/maze');
        const mazes = await response.json();
        
        const mazeListContainer = document.getElementById('saved-mazes-list');
        mazeListContainer.innerHTML = '';
        
        if (mazes.length === 0) {
            mazeListContainer.innerHTML = '<p>No saved mazes yet.</p>';
            return;
        }
        
        mazes.forEach(maze => {
            const mazeItem = document.createElement('div');
            mazeItem.className = 'maze-item';
            mazeItem.innerHTML = `
                <strong>${maze.name}</strong><br>
                Size: ${maze.width}x${maze.height}<br>
                Created: ${new Date(maze.createdAt).toLocaleString()}
            `;
            mazeItem.onclick = () => loadSavedMaze(maze.id);
            mazeListContainer.appendChild(mazeItem);
        });
    } catch (error) {
        console.error('Error loading saved mazes:', error);
        document.getElementById('saved-mazes-list').innerHTML = 
            '<p>Error loading saved mazes. Please try again.</p>';
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
    } catch (error) {
        console.error('Error loading maze:', error);
        alert('Error loading maze. Please try again.');
    }
}

function displayMaze(mazeData) {
    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    const mazeRows = mazeData.trim().split('\n');
    mazeRows.forEach(rowStr => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';

        const cells = rowStr.split('');
        cells.forEach(cell => {
            const cellDiv = document.createElement('div');
            cellDiv.style.width = '20px';
            cellDiv.style.height = '20px';
            cellDiv.style.border = '1px solid black';
            cellDiv.style.backgroundColor = cell === '1' ? 'black' : 'white';
            rowDiv.appendChild(cellDiv);
        });

        mazeContainer.appendChild(rowDiv);
    });
}

function displaySolvedMaze(solvedMaze) {
    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    for (let i = 0; i < solvedMaze.length; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';

        for (let j = 0; j < solvedMaze[i].length; j++) {
            const cellDiv = document.createElement('div');
            cellDiv.style.width = '24px';
            cellDiv.style.height = '24px';
            cellDiv.style.border = '1px solid #aaa';
            
            // Special handling for start and end points
            if (i === 0 && j === 0) {
                // Start point
                cellDiv.className = 'start-point';
                cellDiv.title = 'Start';
            } else if (i === solvedMaze.length - 1 && j === solvedMaze[i].length - 1) {
                // End point
                cellDiv.className = 'end-point';
                cellDiv.title = 'End';
            } else {
                // 0 = path, 1 = wall, 2 = solution path
                if (solvedMaze[i][j] === 1) {
                    cellDiv.style.backgroundColor = '#333';
                    cellDiv.title = 'Wall';
                } else if (solvedMaze[i][j] === 2) {
                    cellDiv.style.backgroundColor = '#4CAF50';
                    cellDiv.className = 'maze-cell solution';
                    cellDiv.title = 'Solution Path';
                } else {
                    cellDiv.style.backgroundColor = 'white';
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
    const rows = mazeContainer.children.length;
    const cols = mazeContainer.children[0].children.length;

    const maze = [];
    for (let i = 0; i < rows; i++) {
        const row = [];
        for (let j = 0; j < cols; j++) {
            const cell = mazeContainer.children[i].children[j];
            row.push(cell.style.backgroundColor === 'black' ? 1 : 0);
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
                <div style="margin-top: 10px; padding: 10px; background-color: #e8f5e9; border-radius: 4px;">
                    <p style="color: green; font-weight: bold;">${result.message}</p>
                    <details>
                        <summary>View Path Details</summary>
                        <p style="font-family: monospace;">${result.path}</p>
                    </details>
                </div>
            `;
        } else {
            document.getElementById('result').innerHTML = `
                <div style="margin-top: 10px; padding: 10px; background-color: #ffebee; border-radius: 4px;">
                    <p style="color: red; font-weight: bold;">${result.message}</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error solving maze:', error);
        document.getElementById('result').innerHTML = `
            <div style="margin-top: 10px; padding: 10px; background-color: #ffebee; border-radius: 4px;">
                <p style="color: red; font-weight: bold;">Error solving maze. Please try again.</p>
            </div>
        `;
    }
}