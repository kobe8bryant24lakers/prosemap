const tablist = document.querySelector('[role="tablist"]');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];
const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

function selectTab(index, focus = false) {
  tabs.forEach((tab, current) => {
    const selected = current === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panels[current].hidden = !selected;
  });
  if (focus) tabs[index].focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectTab(next, true);
    }
  });
});

selectTab(0);
document.documentElement.classList.add('js');

const dialog = document.querySelector('.image-dialog');
const image = dialog.querySelector('img');
let opener;
if (typeof dialog.showModal === 'function') {
  const closeDialog = () => {
    dialog.close();
    opener?.focus({ preventScroll: true });
  };
  document.querySelectorAll('.screenshot-link').forEach(link => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      link.focus({ preventScroll: true });
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      dialog.showModal();
      dialog.querySelector('.image-dialog-scroll').scrollTo(0, 0);
    });
  });
  dialog.querySelector('[data-close-dialog]').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  });
}
