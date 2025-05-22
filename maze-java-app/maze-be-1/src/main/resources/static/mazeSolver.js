async function generateMaze() {
    const rows = document.getElementById('rows').value;
    const cols = document.getElementById('cols').value;

    const response = await fetch(`/generate-maze?rows=${rows}&cols=${cols}`);
    const maze = await response.json();
    console.log(">>> maze = " + JSON.stringify(maze));

    const mazeContainer = document.getElementById('maze-container');
    mazeContainer.innerHTML = '';

    maze.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';

        row.forEach(cell => {
            const cellDiv = document.createElement('div');
            cellDiv.style.width = '20px';
            cellDiv.style.height = '20px';
            cellDiv.style.border = '1px solid black';
            cellDiv.style.backgroundColor = cell === 1 ? 'black' : 'white';
            rowDiv.appendChild(cellDiv);
        });

        mazeContainer.appendChild(rowDiv);
    });
}

// function solveMaze() {
//     alert('Maze solving logic will be implemented here.');
// }