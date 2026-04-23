import { NextPageContext } from 'next';
import { Box, Text } from '@interchain-ui/react';

interface ErrorProps {
  statusCode?: number;
}

export default function Error({ statusCode }: ErrorProps) {
  return (
    <Box maxWidth="600px" mx="auto" mt="120px" textAlign="center">
      <Text fontSize="64px" fontWeight="700" attributes={{ mb: '8px' }}>
        {statusCode ?? '?'}
      </Text>
      <Text fontSize="$lg" color="$textSecondary">
        {statusCode === 404
          ? 'Page not found.'
          : statusCode === 500
            ? 'An error occurred on the server.'
            : 'An unexpected error occurred.'}
      </Text>
    </Box>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};