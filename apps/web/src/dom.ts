/**
 * Минимальный помощник для построения DOM.
 *
 * Фреймворка в M0 нет намеренно: экранов два, а лишняя зависимость вне
 * зафиксированного стека — это решение, которое принимает не агент.
 *
 * Важно: текст всегда добавляется через textContent, никогда через
 * innerHTML. Имя персонажа приходит из БД и попадает на экран деревни —
 * этого достаточно, чтобы innerHTML стал дырой.
 */
export type Child = string | Node;

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: Child[] = [],
  listeners: Record<string, (event: Event) => void> = {},
): HTMLElement {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }

  for (const child of children) {
    if (child === '') continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  for (const [event, handler] of Object.entries(listeners)) {
    node.addEventListener(event, handler);
  }

  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
