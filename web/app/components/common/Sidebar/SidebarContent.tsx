import Image from 'next/image';
import { Box, useColorModeValue, Text } from '@interchain-ui/react';

import { NavItems } from './NavItems';

export const SidebarContent = ({ onClose }: { onClose: () => void }) => {
  const poweredByLogoSrc = useColorModeValue(
    '/logos/hyperweb-logo.svg',
    '/logos/hyperweb-logo-dark.svg',
  );

  return (
    <Box
      flex="1"
      display="flex"
      flexDirection="column"
      alignItems="center"
      width="100%"
    >
      <NavItems onItemClick={onClose} />
      <Box mt="$auto">
        <Box
          mt="10px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          py="10px"
          gap="10px"
        >
          <Text fontSize="12px" fontWeight="500" color="$text">
            Powered by
          </Text>
          <Image
            src={poweredByLogoSrc}
            alt="cosmology"
            width="0"
            height="0"
            style={{ width: '90px', height: 'auto' }}
          />
        </Box>
      </Box>
    </Box>
  );
};
