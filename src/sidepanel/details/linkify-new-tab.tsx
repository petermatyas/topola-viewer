import Linkify from 'linkify-react';

interface Props {
  children: React.ReactNode;
}

const OPTIONS = {
  target: '_blank',
  rel: 'noopener noreferrer',
};

/**
 * A wrapper component that uses linkify-react to convert any plain text URLs
 * within its children into clickable links that open in a new tab.
 */
export function LinkifyNewTab({children}: Props) {
  return <Linkify options={OPTIONS}>{children}</Linkify>;
}
