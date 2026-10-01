import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShopFite — thoughtful finds for everyday living",
  description: "Discover useful, well-made things for your home and everyday life.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
