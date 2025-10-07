import { Box, Container, Header, SpaceBetween } from '@cloudscape-design/components';
import type { OrderCard as OrderCardType } from '../store/chatStore';

type Props = { card: OrderCardType };

export function OrderCard({ card }: Props) {
  return (
    <Container
      header={<Header variant="h3">Order confirmed</Header>}
      footer={<Box variant="awsui-key-label">Order ID: {card.orderId}</Box>}
    >
      <SpaceBetween size="xs">
        {card.item?.image && (
          <Box>
            <img
              src={card.item.image}
              alt={card.item.title}
              width={240}
              height={180}
              loading="lazy"
              decoding="async"
              className="order-media-img"
              onError={(e) => {
                const img = e.currentTarget;
                img.onerror = null; // prevent infinite loop
                img.src = 'https://picsum.photos/seed/placeholder/240/180';
              }}
            />
          </Box>
        )}
        <Box>
          <Box variant="awsui-key-label">Item</Box>
          <div>{card.item.title} ({card.item.id})</div>
        </Box>
        <Box>
          <Box variant="awsui-key-label">Quantity</Box>
          <div>{card.quantity}</div>
        </Box>
        <Box>
          <Box variant="awsui-key-label">Total</Box>
          <div>${card.total}</div>
        </Box>
      </SpaceBetween>
    </Container>
  );
}
