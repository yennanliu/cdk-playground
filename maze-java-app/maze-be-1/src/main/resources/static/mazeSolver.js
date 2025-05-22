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
    const response = await fetch('/api/maze');
    const mazes = await response.json();
    
    const select = document.getElementById('savedMazes');
    select.innerHTML = '<option value="">Select a maze...</option>';
    
    mazes.forEach(maze => {
        const option = document.createElement('option');
        option.value = maze.id;
        option.textContent = `${maze.name} (${maze.width}x${maze.height})`;
        select.appendChild(option);
    });
}

async function loadSavedMaze() {
    const select = document.getElementById('savedMazes');
    const mazeId = select.value;
    
    if (!mazeId) return;
    
    const response = await fetch(`/api/maze/${mazeId}`);
    const maze = await response.json();
    
    currentMazeId = maze.id;
    displayMaze(maze.mazeData);
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

// function solveMaze() {
//     alert('Maze solving logic will be implemented here.');
// }