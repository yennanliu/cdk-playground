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

    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    // Parse the maze data string back into a 2D array
    const mazeRows = mazeData.mazeData.trim().split('\n');
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