// 提示位于弹框外，点击提示时保留弹框及尚未保存的表单。
export function preventToastDismiss(
  event: CustomEvent<{ originalEvent: Event }>,
): void {
  const target = event.detail.originalEvent.target;
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) {
    event.preventDefault();
  }
}
