function hidePageLoader(){
  const loader = document.getElementById('pageLoader');
  if (loader) loader.classList.add('hidden');
}
function showPageLoader(text='Loading...'){
  const loader = document.getElementById('pageLoader');
  if (!loader) return;
  const span = loader.querySelector('span');
  if (span) span.textContent = text;
  loader.classList.remove('hidden');
}
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(hidePageLoader, 650);
  document.querySelectorAll('a[href$=".html"]').forEach(link => {
    link.addEventListener('click', () => showPageLoader('Loading...'));
  });
});
window.showPageLoader = showPageLoader;
window.hidePageLoader = hidePageLoader;
