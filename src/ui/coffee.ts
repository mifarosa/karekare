import { t } from '../i18n';
import { COFFEE_URL } from '../links';
import { h } from './dom';
import { icon } from './icons';

/** "Buy me a coffee" link styled as a button; opens in a new tab/browser. */
export function coffeeButton(): HTMLAnchorElement {
  return h(
    'a',
    { class: 'coffee-btn', href: COFFEE_URL, target: '_blank', rel: 'noopener', title: t('buyCoffeeHint') },
    icon('coffee', 18),
    t('buyCoffee'),
  );
}
