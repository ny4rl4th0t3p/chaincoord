import Link from 'next/link';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Box, Stack, Text } from '@interchain-ui/react';
import { useAuth } from '@/contexts';

const RiHome7Line = dynamic(() => import('react-icons/ri').then(mod => mod.RiHome7Line), { ssr: false });
const RiAddLine = dynamic(() => import('react-icons/ri').then(mod => mod.RiAddLine), { ssr: false });
const RiShieldLine = dynamic(() => import('react-icons/ri').then(mod => mod.RiShieldLine), { ssr: false });

type NavItem = {
  icon: JSX.Element;
  label: string;
  href: string;
};

export const ROUTES = {
  HOME: '/',
  NEW_LAUNCH: '/launch/new',
  ADMIN: '/admin',
} as const;

const navItems: NavItem[] = [
  {
    icon: <RiHome7Line size="20px" />,
    label: 'Launches',
    href: ROUTES.HOME,
  },
  {
    icon: <RiAddLine size="20px" />,
    label: 'New Launch',
    href: ROUTES.NEW_LAUNCH,
  },
  {
    icon: <RiShieldLine size="20px" />,
    label: 'Admin',
    href: ROUTES.ADMIN,
  },
];

const NavItem = ({
  icon,
  label,
  href,
  onClick,
}: NavItem & { onClick?: () => void }) => {
  const router = useRouter();
  const isActive = router.pathname === href;

  return (
    <Link href={href}>
      <Box
        p="10px"
        display="flex"
        alignItems="center"
        gap="10px"
        height="40px"
        cursor="pointer"
        borderRadius="4px"
        color="$text"
        attributes={{ onClick }}
        backgroundColor={{
          hover: '$purple200',
          base: isActive ? '$purple200' : 'transparent',
        }}
      >
        {icon}
        <Text fontSize="$md" fontWeight="$medium">
          {label}
        </Text>
      </Box>
    </Link>
  );
};

export const NavItems = ({ onItemClick }: { onItemClick?: () => void }) => {
  const { isCoordinator } = useAuth();
  const visibleItems = navItems.filter(
    (item) => item.href !== ROUTES.NEW_LAUNCH || isCoordinator,
  );
  return (
    <Stack direction="vertical" space="20px" attributes={{ width: '100%' }}>
      {visibleItems.map(({ href, icon, label }) => (
        <NavItem
          key={label}
          icon={icon}
          label={label}
          href={href}
          onClick={onItemClick}
        />
      ))}
    </Stack>
  );
};
