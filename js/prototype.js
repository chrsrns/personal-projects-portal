document.querySelectorAll('.row .cell').forEach((cell) => {
  cell.addEventListener('click', () => {
    const row = cell.closest('.row');
    const index = Array.from(row.children).indexOf(cell) + 1;
    const isExpanded = cell.classList.contains('expanded');

    document.querySelectorAll('.cell.expanded').forEach((c) => c.classList.remove('expanded'));
    document.querySelectorAll('.row.expanded-1, .row.expanded-2, .row.expanded-3').forEach((r) => {
      r.classList.remove('expanded-1', 'expanded-2', 'expanded-3');
    });

    if (!isExpanded) {
      cell.classList.add('expanded');
      row.classList.add(`expanded-${index}`);
    }
  });
});
