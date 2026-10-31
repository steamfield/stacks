import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from '../components/styled';
import { useHealth } from '../lib/queries/use-health';

export default function Home() {
  const health = useHealth();
  return (
    <SafeAreaView className="flex-1 bg-page">
      <View className="gap-4 p-6">
        <Text className="text-2xl text-ink">API connection</Text>
        {health.isPending && <Text>Connecting…</Text>}
        {health.data && <Text>API status: {health.data.status}</Text>}
        {health.error && (
          <View className="gap-4">
            <Text accessibilityRole="alert" className="text-danger">
              Cannot reach the API. Try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry API connection"
              onPress={async () => {
                await health.refetch();
              }}
            >
              <Text className="text-ink">Retry</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
