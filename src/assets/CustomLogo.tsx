import React from 'react';
import logo from './logo1.webp';
import Image from 'next/image';


export default function CustomLogo() {
  return (
    <div className="logo">
      <Image
        src={logo.src}
        alt="TRBL Design Logo"
        width={200}
        height={200}
      />
    </div>
  );
}



