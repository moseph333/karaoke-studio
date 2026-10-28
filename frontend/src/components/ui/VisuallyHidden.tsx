import React from 'react';

export const VisuallyHidden: React.FC<{ children: React.ReactNode; id?: string }> = ({
  children,
  id,
}) => (
  <span id={id} className="sr-only">
    {children}
  </span>
);
