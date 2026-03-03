let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'fixed bottom-6 right-6 z-[100] flex flex-col gap-2';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 3000) {
  const colors = {
    info: 'bg-charcoal text-white',
    success: 'bg-leaf text-white',
    error: 'bg-danger text-white',
    warning: 'bg-mango text-white',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${colors[type] || colors.info} px-5 py-3 rounded-2xl text-[15px] font-medium shadow-lg max-w-sm`;
  toast.textContent = message;

  getContainer().appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
