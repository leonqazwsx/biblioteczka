namespace Biblioteczka.Host;

/// <summary>Allows a limited number of automatic restarts within a sliding window.</summary>
internal sealed class RestartBudget(int maxAttempts, TimeSpan window)
{
    private readonly Queue<DateTime> _attempts = new();

    public bool TryReserve(DateTime now)
    {
        while (_attempts.Count > 0 && now - _attempts.Peek() >= window) _attempts.Dequeue();
        if (_attempts.Count >= maxAttempts) return false;
        _attempts.Enqueue(now);
        return true;
    }
}
