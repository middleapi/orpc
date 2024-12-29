import Image from 'next/image'

export default function NavbarLogo() {
  return (
    <Image src="/logo.webp" alt="oRPC" width={60} height={100} unoptimized />
  )
}
