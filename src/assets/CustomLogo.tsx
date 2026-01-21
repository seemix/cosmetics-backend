import React from 'react';
// import './logo.scss';
import logo from './logo1.webp';


export default function CustomLogo() {
  return (
    <div className="logo">
      <img
        src={logo.src}
        alt="TRBL Design Logo"
        width={200}
        height={200}
      />
    </div>
  );
}



